(function (exports) {
  "strict";

  exports.execute = function (obj) {
    var createCamelCase, createObject, createFeather, createAuth,
      createModule, createWorkbook, createSettings, createUser, sqlCheck,
      done, sql, params;

    sqlCheck = function (table, callback) {
      var sqlChk = "SELECT * FROM pg_tables WHERE schemaname = 'public' AND tablename = $1;";

      obj.client.query(sqlChk, [table], function (err, resp) {
        if (err) {
          callback(err);
          return;
        }

        callback(null, resp.rows.length > 0);
      });
    };

    // Create a camel case function
    createCamelCase = function () {
      sql = "CREATE OR REPLACE FUNCTION to_camel_case(str text) RETURNS text AS $$" +
        "SELECT replace(initcap($1), '_', '');" +
        "$$ LANGUAGE SQL IMMUTABLE;";
      obj.client.query(sql, createObject);
    };

    // Create the base object table
    createObject = function () {
      sqlCheck('object', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE object (" +
            "_pk bigserial PRIMARY KEY," +
            "id text UNIQUE," +
            "created timestamp with time zone," +
            "created_by text," +
            "updated timestamp with time zone," +
            "updated_by text," +
            "is_deleted boolean); " +
            "COMMENT ON TABLE object IS 'Abstract object class from which all other classes will inherit';" +
            "COMMENT ON COLUMN object._pk IS 'Internal primary key';" +
            "COMMENT ON COLUMN object.id IS 'Surrogate key';" +
            "COMMENT ON COLUMN object.created IS 'Create time of the record';" +
            "COMMENT ON COLUMN object.created_by IS 'User who created the record';" +
            "COMMENT ON COLUMN object.updated IS 'Last time the record was updated';" +
            "COMMENT ON COLUMN object.updated_by IS 'Last user who created the record';" +
            "COMMENT ON COLUMN object.is_deleted IS 'Indicates the record is no longer active';" +
            "CREATE OR REPLACE VIEW _object AS SELECT *, to_camel_case(tableoid::regclass::text) AS object_type FROM object;";
          obj.client.query(sql, createAuth);
          return;
        }
        createAuth();
      });
    };

    // Create the object auth table
    createAuth = function () {
      sqlCheck('$auth', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$auth\" (" +
            "pk serial PRIMARY KEY," +
            "object_pk bigint not null," +
            "role_pk bigint not null," +
            "can_create boolean not null," +
            "can_read boolean not null," +
            "can_update boolean not null," +
            "can_delete boolean not null," +
            "is_member_auth boolean not null," +
            "CONSTRAINT \"$auth_object_pk_role_pk_is_member_auth_key\" UNIQUE (object_pk, role_pk, is_member_auth));" +
            "COMMENT ON TABLE \"$auth\" IS 'Table for storing object level authorization information';" +
            "COMMENT ON COLUMN \"$auth\".pk IS 'Primary key';" +
            "COMMENT ON COLUMN \"$auth\".object_pk IS 'Primary key for object authorization applies to';" +
            "COMMENT ON COLUMN \"$auth\".role_pk IS 'Primary key for role authorization applies to';" +
            "COMMENT ON COLUMN \"$auth\".can_create IS 'Can create the object';" +
            "COMMENT ON COLUMN \"$auth\".can_read IS 'Can read the object';" +
            "COMMENT ON COLUMN \"$auth\".can_update IS 'Can update the object';" +
            "COMMENT ON COLUMN \"$auth\".can_delete IS 'Can delete the object';" +
            "COMMENT ON COLUMN \"$auth\".is_member_auth IS 'Is authorization for members of a parent';";
          obj.client.query(sql, createFeather);
          return;
        }
        createFeather();
      });
    };

    // Create the feather table
    createFeather = function () {
      sqlCheck('$feather', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$feather\" (" +
            "is_child boolean," +
            "parent_pk bigint," +
            "CONSTRAINT feather_pkey PRIMARY KEY (_pk), " +
            "CONSTRAINT feather_id_key UNIQUE (id)) INHERITS (object);" +
            "COMMENT ON TABLE \"$feather\" is 'Internal table for storing class names';";
          obj.client.query(sql, createModule);
          return;
        }
        createModule();
      });
    };

    // Create the module table
    createModule = function () {
      sqlCheck('$module', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$module\" (" +
            "name text PRIMARY KEY," +
            "script text," +
            "version text);" +
            "COMMENT ON TABLE \"$module\" IS 'Internal table for storing JavaScript';" +
            "COMMENT ON COLUMN \"$module\".name IS 'Primary key';" +
            "COMMENT ON COLUMN \"$module\".script IS 'JavaScript';" +
            "COMMENT ON COLUMN \"$module\".version IS 'Version number';";
          obj.client.query(sql, createWorkbook());
          return;
        }
        createWorkbook();
      });
    };

    // Create the workbook table
    createWorkbook = function () {
      sqlCheck('$workbook', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$workbook\" (" +
            "name text UNIQUE," +
            "description text," +
            "launch_config json," +
            "default_config json," +
            "local_config json," +
            "module text REFERENCES \"$module\" (name)," +
            "CONSTRAINT workbook_pkey PRIMARY KEY (_pk), " +
            "CONSTRAINT workbook_id_key UNIQUE (id)) INHERITS (object);" +
            "COMMENT ON TABLE \"$workbook\" IS 'Internal table for storing workbook';" +
            "COMMENT ON COLUMN \"$workbook\".name IS 'Primary key';" +
            "COMMENT ON COLUMN \"$workbook\".description IS 'Description';" +
            "COMMENT ON COLUMN \"$workbook\".launch_config IS 'Launcher configuration';" +
            "COMMENT ON COLUMN \"$workbook\".default_config IS 'Default configuration';" +
            "COMMENT ON COLUMN \"$workbook\".local_config IS 'Local configuration';" +
            "COMMENT ON COLUMN \"$workbook\".module IS 'Foreign key to module';";
          obj.client.query(sql, createUser);
          return;
        }
        createUser();
      });
    };

    // Create the user table
    createUser = function () {
      sqlCheck('$user', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$user\" (" +
            "username text PRIMARY KEY," +
            "is_super boolean);" +
            "COMMENT ON TABLE \"$user\" IS 'Internal table for storing supplimental user information';" +
            "COMMENT ON COLUMN \"$user\".username IS 'System user';" +
            "COMMENT ON COLUMN \"$user\".is_super IS 'Indicates whether user is super user';";
          obj.client.query(sql, function (err) {
            if (err) {
              obj.callback(err);
              return;
            }

            obj.client.query("INSERT INTO \"$user\" VALUES ($1, true)", [obj.user], createSettings);
          });
          return;
        }
        createSettings();
      });
    };

    // Create the settings table
    createSettings = function () {
      sqlCheck('$settings', function (err, exists) {
        if (err) {
          obj.callback(err);
          return;
        }

        if (!exists) {
          sql = "CREATE TABLE \"$settings\" (" +
            "name text," +
            "data json," +
            "etag text," +
            "CONSTRAINT settings_pkey PRIMARY KEY (_pk), " +
            "CONSTRAINT settings_id_key UNIQUE (id)) INHERITS (object);" +
            "COMMENT ON TABLE \"$settings\" IS 'Internal table for storing system settings';" +
            "COMMENT ON COLUMN \"$settings\".name IS 'Name of settings';" +
            "COMMENT ON COLUMN \"$settings\".data IS 'Object containing settings';";
          obj.client.query(sql, function (err) {
            if (err) {
              obj.callback(err);
              return;
            }

            sql = "INSERT INTO \"$settings\" VALUES (nextval('object__pk_seq'), $1, now(), CURRENT_USER, now(), CURRENT_USER, false, $2, $3);";
            params = [
              "catalog",
              "catalog",
              JSON.stringify({
                Object: {
                  description: "Abstract object class from which all feathers will inherit",
                  discriminator: "objectType",
                  plural: "Objects",
                  properties: {
                    id: {
                      description: "Surrogate key",
                      type: "string",
                      default: "createId()",
                      isRequired: true,
                      isReadOnly: true
                    },
                    created: {
                      description: "Create time of the record",
                      type: "string",
                      format: "dateTime",
                      default: "now()",
                      isReadOnly: true
                    },
                    createdBy: {
                      description: "User who created the record",
                      type: "string",
                      default: "getCurrentUser()",
                      isReadOnly: true
                    },
                    updated: {
                      description: "Last time the record was updated",
                      type: "string",
                      format: "dateTime",
                      default: "now()",
                      isReadOnly: true
                    },
                    updatedBy: {
                      description: "User who created the record",
                      type: "string",
                      default: "getCurrentUser()",
                      isReadOnly: true
                    },
                    isDeleted: {
                      description: "Indicates the record is no longer active",
                      type: "boolean",
                      isReadOnly: true
                    },
                    objectType: {
                      description: "Discriminates which inherited object type the object represents",
                      type: "string",
                      isReadOnly: true
                    }
                  }
                }
              })
            ];
            obj.client.query(sql, params, done);
          });
          return;
        }
        done();
      });
    };

    done = function () {
      obj.callback();
    };

    // Real work starts here
    createCamelCase();
  };

}(exports));

/** Drop everything

  DROP TABLE object CASCADE;
  DROP TABLE "$auth";
  DROP TABLE "$module";
  DROP TABLE "$sheet";
  DROP TABLE "$user";
  DROP FUNCTION to_camel_case(text);
*/

