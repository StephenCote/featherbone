/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/
/*jslint node eval*/
(function (exports) {
    "use strict";

    const MANIFEST = "manifest.json";

    const {API} = require("./api");
    const fs = require("fs");
    const path = require("path");
    const f = require("../../common/core");

    f.jsonpatch = require("fast-json-patch");

    const api = new API();

    function btoa(str) {
        return Buffer.from(str.toString(), "binary").toString("base64");
    }

    exports.Installer = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
          Install a package in a specified directory.

          @param {Object} Initialized datasource (catalog loaded)
          @param {Object} Client
          @param {String} Directory of manifest
          @param {String} User name
          @return {Object} Promise
        */
        that.install = function (datasource, client, dir, user) {
            return new Promise(function (resolve, reject) {
                let manifest;
                let processFile;
                let i = 0;
                let file;
                let filename = path.format({
                    root: "/",
                    dir: dir,
                    base: MANIFEST
                });

                f.datasource = datasource;

                function rollback(err) {
                    client.query("ROLLBACK;", function () {
                        console.error(err);
                        //console.log("ROLLBACK");
                        console.error("Installation failed.");
                        resolve();
                    });
                }

                function runBatch(data) {
                    let nextItem;
                    let len = data.length;
                    let b = 0;

                    // Ensure all recentely installed services are now available
                    function getServices() {
                        let payload;
                        let after;

                        after = function (resp) {
                            resp.forEach(function (service) {
                                new Function(
                                    "f",
                                    "\"use strict\";" + service.script
                                )(f);
                            });

                            nextItem();
                        };

                        payload = {
                            method: "GET",
                            name: "getServices",
                            user: user,
                            client: client
                        };

                        datasource.request(payload).then(
                            after
                        ).catch(
                            rollback
                        );
                    }

                    // Iterate recursively
                    nextItem = function () {
                        let payload;

                        if (b < len) {
                            payload = data[b];
                            payload.user = user;
                            payload.client = client;
                            b += 1;
                            datasource.request(payload).then(
                                nextItem
                            ).catch(rollback);
                            return;
                        }

                        // We're done here
                        processFile();
                    };

                    // Start processing
                    getServices();
                }

                function saveModule(name, script, version, dependencies) {
                    dependencies = dependencies || [];
                    let id = btoa(name);
                    let payload = {
                        method: "POST",
                        name: "Module",
                        user: user,
                        client: client,
                        id: id,
                        data: {
                            name: name,
                            version: version,
                            script: script,
                            dependencies: dependencies.map(function (dep) {
                                return {
                                    module: {
                                        id: btoa(dep)
                                    }
                                };
                            })
                        }
                    };

                    runBatch([payload]);
                }

                function saveFeathers(feathers, isSystem) {
                    let payload;
                    let data = [];

                    // System feathers don't get to be tables
                    if (isSystem) {
                        payload = {
                            method: "PUT",
                            name: "saveFeather",
                            user: user,
                            client: client,
                            data: {
                                specs: feathers
                            }
                        };

                        datasource.request(payload).then(
                            processFile
                        ).catch(rollback);
                        return;
                    }

                    // Map feather structure to table structure
                    feathers.forEach(function (feather) {
                        let keys = Object.keys(feather.properties || {});
                        let props = feather.properties;
                        let overloads = feather.overloads || {};

                        feather.properties = keys.map(function (key) {
                            let prop = props[key];

                            prop.name = key;

                            return prop;
                        });

                        keys = Object.keys(feather.overloads || {});
                        feather.overloads = keys.map(function (key) {
                            let overload = overloads[key] || {};
                            let row = {};

                            row.name = key;

                            if (overload.description !== undefined) {
                                row.overloadDescription = true;
                                row.description = overload.description;
                            } else {
                                row.overloadDescription = false;
                                row.description = "";
                            }

                            if (overload.alias !== undefined) {
                                row.overloadAlias = true;
                                row.alias = overload.alias;
                            } else {
                                row.overloadAlias = false;
                                row.alias = "";
                            }

                            if (overload.type !== undefined) {
                                row.overloadType = true;
                                row.type = overload.type;
                            } else {
                                row.overloadType = false;
                                row.type = null;
                            }

                            if (overload.default !== undefined) {
                                row.overloadDefault = true;
                                row.default = overload.default;
                            } else {
                                row.overloadDefault = false;
                                row.default = null;
                            }

                            if (overload.dataList !== undefined) {
                                row.overloadDataList = true;
                                row.dataList = overload.dataList;
                            } else {
                                row.overloadDataList = false;
                                row.dataList = null;
                            }

                            return row;
                        });

                        data.push({
                            name: "Feather",
                            method: "POST",
                            id: feather.name,
                            data: feather
                        });
                    });

                    runBatch(data);
                }

                function saveService(name, module, script) {
                    let id = btoa("ds" + name);
                    let payload = {
                        method: "POST",
                        name: "DataService",
                        user: user,
                        client: client,
                        id: id,
                        data: {
                            name: name,
                            module: module,
                            script: script
                        }
                    };

                    runBatch([payload]);
                }

                function saveWorkbooks(workbooks) {
                    let payload = {
                        method: "PUT",
                        name: "saveWorkbook",
                        user: user,
                        client: client,
                        data: {
                            specs: workbooks
                        }
                    };

                    datasource.request(payload).then(
                        processFile
                    ).catch(rollback);
                }

                function execute(filename) {
                    let dep = path.resolve(filename);
                    let exp = require(dep);

                    exp.execute({
                        user: user,
                        client: client
                    }).then(processFile.bind(client)).catch(rollback);
                }

                function install(filename) {
                    let subman;
                    let subfilepath = path.format({
                        root: "/",
                        dir: dir,
                        base: filename
                    });
                    let subdir = path.parse(filename).dir;
                    let n = i;

                    fs.readFile(subfilepath, "utf8", function (err, data) {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        subman = JSON.parse(data);
                        subman.files.forEach(function (file) {
                            file.path = subdir + "/" + file.path;
                            file.module = file.module || subman.module;
                            file.module = file.module || manifest.module;
                            file.version = file.version || subman.version;
                            file.version = file.version || manifest.version;
                            file.dependencies = (
                                file.dependencies || subman.dependencies
                            );
                            file.dependencies = (
                                file.dependencies || manifest.dependencies
                            );
                            manifest.files.splice(n, 0, file);
                            n += 1;
                        });
                        processFile();
                    });
                }

                function defineSettings(settings) {
                    let sql;
                    let params = [settings.name, settings];

                    sql = "SELECT * FROM \"$settings\" WHERE name='";
                    sql += settings.name + "';";

                    client.query(sql, function (err, result) {
                        if (err) {
                            rollback(err);
                            return;
                        }
                        if (result.rows.length) {
                            sql = "UPDATE \"$settings\" SET ";
                            sql += "definition=$2 WHERE name=$1;";
                        } else {
                            params.push(user);
                            sql = (
                                "INSERT INTO \"$settings\" " +
                                "(name, definition, id, created, " +
                                "created_by, updated, updated_by, " +
                                "is_deleted) " +
                                "VALUES ($1, $2, $1, now(), $3, now(), $3, " +
                                "false);"
                            );
                        }

                        client.query(sql, params, processFile);
                    });
                }

                processFile = function () {
                    let filepath;
                    let module;
                    let version;
                    let dependencies;
                    let content;
                    let name;

                    function complete() {
                        console.log("Installation completed!");
                        resolve();
                    }

                    file = manifest.files[i];
                    i += 1;

                    // If we've processed all the files, wrap this up
                    if (!file) {
                        //console.log("COMMIT");
                        client.query("COMMIT;").then(
                            api.build.bind(null, datasource, user)
                        ).then(complete).catch(reject);

                        return;
                    }

                    filename = file.path;
                    name = path.parse(filename).name;
                    filepath = path.format({
                        root: "/",
                        dir: dir,
                        base: filename
                    });

                    module = file.module || manifest.module;
                    version = file.version || manifest.version;
                    dependencies = file.dependencies || manifest.dependencies;

                    fs.readFile(filepath, "utf8", function (err, data) {
                        if (err) {
                            console.error(err);
                            return;
                        }

                        content = data;

                        console.log("Installing " + filename);

                        switch (file.type) {
                        case "install":
                            install(filename);
                            break;
                        case "execute":
                            execute(filename);
                            break;
                        case "module":
                            saveModule(module, content, version, dependencies);
                            break;
                        case "service":
                            saveService(file.name || name, module, content);
                            break;
                        case "feather":
                            saveFeathers(JSON.parse(content), file.isSystem);
                            break;
                        case "batch":
                            runBatch(JSON.parse(content));
                            break;
                        case "workbook":
                            saveWorkbooks(JSON.parse(content));
                            break;
                        case "settings":
                            defineSettings(JSON.parse(content));
                            break;
                        default:
                            rollback("Unknown type.");
                            return;
                        }
                    });
                };

                fs.readFile(filename, "utf8", function (err, data) {
                    if (err) {
                        reject(err);
                    }

                    manifest = JSON.parse(data);
                    client.query("BEGIN;").then(processFile);
                });
            });
        };

        return that;
    };

}(exports));

