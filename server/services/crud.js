/*
    Framework for building object relational database apps
    Copyright (C) 2022  John Rogelstad

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
*/
/*jslint node, for, devel, unordered*/
/**
    Create, read, update and delete methods for persisting data to the
    database.
    @module CRUD
*/
(function (exports) {
    "use strict";

    const {Currency} = require("./currency");
    const {Database} = require("../database");
    const {Events} = require("./events");
    const {Feathers} = require("./feathers");
    const {Tools} = require("./tools");

    const currency = new Currency();
    const db = new Database();
    const events = new Events();
    const feathers = new Feathers();
    const tools = new Tools();
    const formats = tools.formats;
    const f = require("../../common/core");
    const ops = Object.keys(f.operators);
    const jsonpatch = require("fast-json-patch");
    const ekey = "_eventkey"; // Lint tyranny

    function noJoin(w) {
        return !w.table && w.property.indexOf(".") === -1;
    }
    function transformObj(where) {
        if (
            typeof where.value === "object" &&
            !Array.isArray(where.value)
        ) {
            where.property = where.property + ".id";
            where.value = where.value.id;
        }
    }

    function appendWhere(where, parts, tokens, params, table, p) {
        let op = where.operator || "=";
        let yr;
        let mo;
        let da;
        let dw;
        let today;
        let d1;
        let d2;
        let part;
        let or;

        function preparePart(prop, tbl) {
            prop = prop || where.property;
            tbl = tbl || table;
            if (prop === "objectType") {
                tokens.push(tbl);
                return "to_camel_case(%I.tableoid::regclass::text)";
            }

            tokens.push(tbl);
            tokens.push(prop.toSnakeCase());
            return "%I.%I";
        }

        if (ops.indexOf(op) === -1) {
            throw new Error("Unknown operator \"" + op + "\"");
        }

        // Escape backslash on regex operations
        if (op.indexOf("~") > -1) {
            where.value = where.value.replace(/\\/g, "\\\\");
        }

        // Handle date options
        if (op === "IS") {
            today = f.today();
            yr = today.slice(0, 4) - 0;
            mo = today.slice(5, 7) - 1;
            da = today.slice(8, 10) - 0;
            // ISO week starts Monday
            dw = f.parseDate(today).getDay() - 1;
            if (dw < 0) {
                dw = 7;
            }

            part = preparePart();

            switch (where.value) {
            case "TODAY":
                part += "='" + today + "'";
                break;
            case "BEFORE_TODAY":
                part += "<'" + today + "'";
                break;
            case "ON_OR_BEFORE_TODAY":
                part += "<='" + today + "'";
                break;
            case "ON_OR_AFTER_TODAY":
                part += ">='" + today + "'";
                break;
            case "THIS_WEEK":
                d1 = new Date(yr, mo, da - dw);
                d2 = new Date(yr, mo, da + 6 - dw);
                part += (
                    " BETWEEN '" + d1.toLocalDate() +
                    "' AND '" + d2.toLocalDate() + "'"
                );
                break;
            case "ON_OR_BEFORE_THIS_WEEK":
                d1 = new Date(yr, mo, da + 6 - dw);
                part += (
                    " <= '" + d1.toLocalDate() + "'"
                );
                break;
            case "ON_OR_AFTER_THIS_WEEK":
                d1 = new Date(yr, mo, da - dw);
                part += (
                    " >= '" + d1.toLocalDate() + "'"
                );
                break;
            case "THIS_MONTH":
                d1 = new Date(yr, mo, 1);
                d2 = new Date(yr, mo + 1, 0);
                part += (
                    " BETWEEN '" + d1.toLocalDate() +
                    "' AND '" + d2.toLocalDate() + "'"
                );
                break;
            case "ON_OR_BEFORE_THIS_MONTH":
                d1 = new Date(yr, mo + 1, 0);
                part += (
                    " <= '" + d1.toLocalDate() + "'"
                );
                break;
            case "ON_OR_AFTER_THIS_MONTH":
                d1 = new Date(yr, mo, 1);
                part += (
                    " >= '" + d1.toLocalDate() + "'"
                );
                break;
            case "THIS_YEAR":
                part += (
                    " BETWEEN '" + yr + "-01-01' AND '" +
                    yr + "-12-31'"
                );
                break;
            case "ON_OR_BEFORE_THIS_YEAR":
                part += (
                    " <= '" + yr + "-12-31'"
                );
                break;
            case "ON_OR_AFTER_THIS_YEAR":
                part += (
                    " >= '" + yr + "-01-01'"
                );
                break;
            case "YESTERDAY":
                d1 = new Date(yr, mo, da - 1);
                part += (
                    " = '" + d1.toLocalDate() + "'"
                );
                break;
            case "LAST_WEEK":
                d1 = new Date(yr, mo, da - dw - 7);
                d2 = new Date(yr, mo, da - dw - 1);
                part += (
                    " BETWEEN '" + d1.toLocalDate() +
                    "' AND '" + d2.toLocalDate() + "'"
                );
                break;
            case "LAST_MONTH":
                d1 = new Date(yr, mo - 1, 1);
                d2 = new Date(yr, mo, 0);
                part += (
                    " BETWEEN '" + d1.toLocalDate() +
                    "' AND '" + d2.toLocalDate() + "'"
                );
                break;
            case "LAST_YEAR":
                yr = yr - 1;
                part += (
                    " BETWEEN '" + yr + "-01-01' AND '" +
                    yr + "-12-31'"
                );
                break;
            case "TOMORROW":
                d1 = new Date(yr, mo, da + 1);
                part += (
                    " = '" + d1.toLocalDate() + "'"
                );
                break;
            case "NEXT_WEEK":
                d1 = new Date(yr, mo, da - dw + 7);
                d2 = new Date(yr, mo, da - dw + 12);
                part += (
                    " BETWEEN '" + d1.toLocalDate() +
                    "' AND '" + d2.toLocalDate() + "'"
                );
                break;
            case "NEXT_MONTH":
                d1 = new Date(yr, mo + 1, 1);
                d2 = new Date(yr, mo + 2, 0);
                part += (
                    " BETWEEN '" + d1.toLocalDate() +
                    "' AND '" + d2.toLocalDate() + "'"
                );
                break;
            case "NEXT_YEAR":
                yr = yr + 1;
                part += (
                    " BETWEEN '" + yr + "-01-01' AND '" +
                    yr + "-12-31'"
                );
                break;
            default:
                throw new Error(
                    "Value " + where.value +
                    " for date operator 'IS' unknown"
                );
            }

        // Value "IN" array ("Andy" IN ["Ann","Andy"])
        // Whether "Andy"="Ann" OR "Andy"="Andy"
        } else if (op === "IN") {
            part = [];
            if (where.value.length) {
                where.value.forEach(function (val) {
                    params.push(val);
                    part.push("$" + p);
                    p += 1;
                });
                part = preparePart() + " IN (" + part.join(",") + ")";
            // If no values in array, then no result
            } else {
                params.push(false);
                part.push("$" + p);
                p += 1;
            }

        // Property "OR" array compared to value
        // (["name","email"]="Andy")
        // Whether "name"="Andy" OR "email"="Andy"
        } else if (Array.isArray(where.property)) {
            or = [];
            where.property.forEach(function (prop) {
                if (typeof prop === "object") { // required join
                    or.push(
                        preparePart(prop.property, prop.table) + op + "$" + p
                    );
                    return;
                }
                or.push(preparePart(prop) + op + "$" + p);
            });
            params.push(where.value);
            p += 1;
            part = "(" + or.join(" OR ") + ")";

        // Regular comparison ("name"="Andy")
        } else if (
            typeof where.value === "object" &&
            !where.value.id
        ) {
            part = preparePart() + " IS NULL";
        } else {
            part = preparePart() + op + "$" + p;
            params.push(where.value);
            p += 1;
        }

        parts.push(part);

        return p;
    }

    function processSort(sort, tokens, table) {
        let order;
        let clause = "";
        let i = 0;
        let parts = [];

        // Always sort on primary key as final tie breaker
        sort.push({property: tools.PKCOL});

        while (sort[i]) {
            order = sort[i].order || "ASC";
            order = order.toUpperCase();
            if (order !== "ASC" && order !== "DESC") {
                throw "Unknown operator \"" + order + "\"";
            }
            tokens.push(sort[i].table || table);
            tokens.push(sort[i].property.toSnakeCase());
            parts.push("%I.%I " + order);
            i += 1;
        }

        if (parts.length) {
            clause = " ORDER BY " + parts.join(",");
        }

        return clause;
    }

    /**
        Return a sql `WHERE` clause based on filter criteria in payload.
        @private
        @method buildWhere
        @param {Object} payload Request payload
        @param {Object} payload.name Feather name
        @param {Filter} [payload.filter] Filter
        @param {Boolean} [payload.showDeleted] Show deleted records
        @param {Object} payload.client Database client
        @param {Array} [params] Parameters used for the sql query
        @param {Boolean} [flag] Request as super user. Default false.
        @param {Boolean} [flag] Enforce row authorization. Default false.
        @return {Promise}
    */
    const JOINSQL = "LEFT JOIN %I %I ON (%I.%I=%I._pk)";
    async function buildWhere(
        obj,
        params,
        isSuperUser,
        rowAuth
    ) {
        let name = obj.name;
        let filter = obj.filter;
        let table = name.toSnakeCase();
        let clause = "NOT %I.is_deleted";
        let sql = " WHERE ";
        let tokens = [table];
        let criteria = false;
        let sort = [];
        let parts = [];
        let p = 1;
        let joinArrays = {
            joinTokens: [],
            partTokens: [],
            joins: [],
            parts: []
        };
        let propsWithDot = [];
        let joined = [];
        let tnr = 1;
        let i = 0;

        function appendDotProp(str) {
            if (
                str.indexOf(".") !== -1 &&
                propsWithDot.indexOf(str) === -1
            ) {
                propsWithDot.push(str);
            }
        }

        /*
        If the last attribute on a sort with dot notation
        is a composite type, then tack on first relation
        property on dot notation. This mimics behavior
        postgres has in native queries sorting on composite
        types.

        i.e. Sort on "item.site" where site is an object
        and "code" is the first property on the site relation
        would be converted to "item.site.code."

        The `buildJoin` function takes care of the rest.
        */
        async function preProcessSort(item) {
            let prop = item.property;
            let idx = 0;
            let attr;
            let fthr = obj.feather;
            let fp;

            while (idx !== -1) {
                idx = prop.indexOf(".");
                if (idx !== -1) {
                    attr = prop.slice(0, idx);
                    fp = fthr.properties[attr];
                    prop = prop.slice(idx + 1, prop.length);
                    fthr = await feathers.getFeather({
                        client: obj.client,
                        data: {name: fp.type.relation}
                    });
                } else {
                    fp = fthr.properties[prop];
                    if (typeof fp.type === "object") {
                        if (
                            Array.isArray(fp.type.properties) &&
                            fp.type.properties[0]
                        ) {
                            item.property += "." + fp.type.properties[0];
                        } else {
                            throw (
                                "No properties defined on relation" + attr
                            );
                        }
                    }
                }
            }
        }

        function processDotProp(item) {
            if (Array.isArray(item.property)) {
                item.property.forEach(appendDotProp);
                return;
            }
            appendDotProp(item.property);
        }

        async function buildJoin(prop) {
            let jtokens = joinArrays.joinTokens;
            let ptokens = joinArrays.partTokens;
            let joins = joinArrays.joins;
            let fthr = obj.feather;
            let idx = prop.indexOf(".");
            let attr = prop.slice(0, idx);
            let theTable;
            let theAlias;
            let fp;
            let fk;
            let where = filter.criteria.find((c) => c.property === prop);
            let whereArys = filter.criteria.filter(
                (c) => (
                    Array.isArray(c.property) &&
                    c.property.indexOf(prop) !== -1
                )
            );
            let jsort = filter.sort.find((s) => s.property === prop);
            let oprop = prop;
            let found;
            let part;
            let jTable;

            while (idx !== -1) {
                fp = fthr.properties[attr];
                if (
                    formats[fp.format] &&
                    formats[fp.format].isMoney
                ) { // Hard coded type
                    where.operator = where.operator || "=";
                    if (where.op === "IN") {
                        part = [];
                        if (where.value.length) {
                            where.value.forEach(function (val) {
                                params.push(val);
                                part.push("$" + p);
                                p += 1;
                            });
                            part = tools.resolvePath(
                                where.property,
                                ptokens
                            ) + " IN (" + part.join(",") + ")";
                        // If no values in array, then no result
                        } else {
                            params.push(false);
                            part.push("$" + p);
                            p += 1;
                        }
                    } else {
                        if (typeof where.value === "object") {
                            where.property = where.property + ".id";
                            where.value = where.value.id;
                        }
                        params.push(where.value);
                        part = tools.resolvePath(
                            where.property,
                            ptokens
                        ) + " " + where.operator + " $" + p;
                        p += 1;
                    }

                    joinArrays.parts.push(part);
                    idx = -1;
                } else {
                    // Join
                    theTable = fp.type.relation.toSnakeCase();
                    fk = "_" + attr.toSnakeCase() + "_" + theTable + "_pk";

                    // If not already joined, do join
                    found = joined.find(
                        (j) => j.table === theTable && j.fkey === fk
                    );
                    if (found) {
                        theAlias = found.alias;
                    } else {
                        jTable = fthr.name.toSnakeCase();
                        found = joined.find((j) => j.table === jTable);
                        if (found) {
                            jTable = found.alias;
                        }
                        joins.push(JOINSQL);
                        theAlias = "t" + tnr;
                        // Join table
                        jtokens.push(theTable);
                        jtokens.push(theAlias);
                        // Parent table prefix
                        jtokens.push(jTable);
                        // Parent table column (feathbone paradigm)
                        jtokens.push(fk);
                        // Join table prefix
                        jtokens.push(theAlias);
                        // Keep track of joins already made
                        joined.push({
                            table: theTable,
                            fkey: fk,
                            alias: theAlias
                        });
                        tnr += 1;
                    }

                    // Advance next
                    prop = prop.slice(idx + 1, prop.length);
                    idx = prop.indexOf(".");
                    if (idx === -1) { // done joining?
                        if (where) {
                            p = appendWhere(
                                {
                                    property: prop,
                                    operator: where.operator,
                                    value: where.value
                                },
                                joinArrays.parts,
                                ptokens,
                                params,
                                theAlias,
                                p
                            );
                        }
                        if (whereArys.length) {
                            whereArys.forEach(function (crit) {
                                let ary = crit.property;
                                ary.splice(ary.indexOf(oprop), 1, {
                                    table: theAlias,
                                    property: prop
                                });
                            });
                        }
                        if (jsort) {
                            jsort.property = prop;
                            jsort.table = theAlias;
                        }
                    } else {
                        // Next join
                        attr = prop.slice(0, idx);
                        fthr = await feathers.getFeather({
                            client: obj.client,
                            data: {name: fp.type.relation}
                        });
                    }
                }
            }
        }

        if (obj.showDeleted) {
            clause = "true";
            tokens = [];
        }

        sql += clause;

        if (filter) {
            filter = f.copy(filter); // Leave original alone
            filter.criteria = filter.criteria || [];
            filter.sort = filter.sort || [];
            criteria = filter.criteria;
            sort = filter.sort;
            criteria.forEach(transformObj);

            filter.criteria.forEach(processDotProp);
            while (i < sort.length) {
                await preProcessSort(sort[i]);
                i += 1;
            }
            sort.forEach(processDotProp);

            // Process joins
            // joins = criteria.filter(hasJoin);
            if (propsWithDot.length) {
                if (tokens.length) {
                    joinArrays.partTokens.push(table);
                }
                joinArrays.parts.push(clause);
                while (propsWithDot.length) {
                    await buildJoin(propsWithDot.shift());
                }
                tokens = joinArrays.joinTokens;
                tokens = tokens.concat(joinArrays.partTokens);
                sql = (
                    " " + joinArrays.joins.join(" ") +
                    " WHERE " +
                    joinArrays.parts.join(" AND ")
                );
            }

            // Process non join criteria
            criteria.filter(noJoin).forEach(function (where) {
                p = appendWhere(where, parts, tokens, params, table, p);
            });

            if (parts.length) {
                sql += " AND " + parts.join(" AND ");
            }
        }

        // Add authorization criteria
        if (isSuperUser === false) {
            sql += tools.buildAuthSql("canRead", table, tokens, rowAuth, p);

            params.push(obj.client.currentUser());
            p += 1;
        }

        // Process sort
        sql += processSort(sort, tokens, table);

        if (filter) {
            // Process offset and limit
            if (filter.offset) {
                sql += " OFFSET $" + p;
                p += 1;
                params.push(filter.offset);
            }

            if (filter.limit) {
                sql += " LIMIT $" + p;
                params.push(filter.limit);
            }
        }

        sql = sql.format(tokens);

        return sql;
    }

    /**
        Return a promise that resolves money object with
        zero amount and base currency. Used as currency
        default.

        @method money
        @for f
        @return {Promise} Resolves to {{#crossLink "Money"}}{{/crossLink}}
    */
    f.money = function () {
        return new Promise(function (resolve, reject) {
            function callback(baseCurr) {
                resolve({
                    amount: 0,
                    currency: baseCurr.code,
                    effective: null,
                    baseAmount: null
                });
            }

            currency.baseCurrency({data: {}}).then(
                callback
            ).catch(
                reject
            );
        });
    };

    /**
        Services for create, read, update and delete actions.

        @class CRUD
        @constructor
        @namespace Services
    */
    exports.CRUD = function () {
        // ..........................................................
        // PRIVATE
        //

        const crud = {};
        let savepoint = false;

        // ..........................................................
        // PUBLIC
        //
        /**
            Begin a transaction block.

            @method begin
            @param {Object} payload Request payload
            @param {String | Object} payload.client Database client
            @return {Promise}
        */
        crud.begin = function (obj) {
            return new Promise(function (resolve, reject) {
                let client = db.getClient(obj.client);
                client.query("BEGIN;").then(resolve).catch(reject);
            });
        };

        /**
            Commit a transaction block.

            @method commit
            @param {Object} payload Request payload
            @param {String | Object} payload.client Database client
            @return {Promise}
        */
        crud.commit = function (obj) {
            return new Promise(function (resolve, reject) {
                let client = db.getClient(obj.client);
                client.query("COMMIT;").then(function () {
                    let callbacks = client.callbacks.slice();
                    function next() {
                        if (callbacks.length) {
                            callbacks.shift()().then(next).catch(console.log);
                        }
                    }
                    next();
                    resolve();
                }).catch(reject);
            });
        };

        /**
            Create a savepoint. Rollbacks will rollback to this point.

            @method savePoint
            @param {Object} payload Request payload
            @param {String | Object} payload.client Database client
            @return {Promise}
        */
        crud.savePoint = function (obj) {
            return new Promise(function (resolve, reject) {
                let client = db.getClient(obj.client);
                savepoint = true;
                client.query(
                    "SAVEPOINT last_savepoint;"
                ).then(resolve).catch(reject);
            });
        };

        /**
            Rollback to the last savepoint.

            @method rollback
            @param {Object} payload Request payload
            @param {String | Object} payload.client Database client
            @param {Object} payload.data Data options
            @param {Boolean} payload.data.toSavePoint
            Whether to rollback to last savepoint. Default true.
            @return {Promise}
        */
        crud.rollback = function (obj) {
            return new Promise(function (resolve, reject) {
                let client = db.getClient(obj.client);
                let sql = "ROLLBACK";
                if (savepoint && (
                    !obj.data || obj.data.savePoint !== false
                )) {
                    sql += " TO SAVEPOINT last_savepoint; COMMIT;";
                    savepoint = false;
                }
                client.query(sql).then(resolve).catch(reject);
            });
        };
        /**
            Return aggregations of numeric values. Supported aggergations are:
            `SUM`, `AVG`, `COUNT`, `MIN` and `MAX`.

            @example
            f.datasourceRequest({
                method: "POST",
                name: "doAggregate",
                data: {
                    name: "Sales",
                    aggregations: [{
                            method: "COUNT",
                            property: "orderNumber",
                            alias: "orderCount"
                        }, {
                            method: "SUM",
                            property: "amount.amount",
                            alias: "amount"
                        }
                    ],
                    filter: {
                        criteria: [{
                            property: "customer.number"
                            value: "C0231"
                        }]
                    }
                }
            });

            @method doAggregate
            @param {Object} payload Request payload
            @param {String} payload.name Name of feather
            @param {Object} [payload.filter] Filter criteria of records to
            select
            @param {Array} [payload.aggregations] Array of aggregations.
            If not specified, all properties will be returned.
            @param {String | Object} payload.client Database client
            @param {Boolean} [ignore] Ignore this parameter.
            @param {Boolean} [isSuperUser] Request as super user. Default false.
            @return {Promise} Resolves to object.
        */
        crud.doAggregate = async function (obj, ignore, isSuperUser) {
            let sql;
            let table;
            let tokens = [];
            let theClient = db.getClient(obj.client);
            let methods = ["SUM", "COUNT", "AVG", "MIN", "MAX"];
            let params = [];
            let sub = [];
            let subt = [];
            let data = {
                name: obj.data.name,
                filter: obj.data.filter,
                client: obj.client
            };
            let feather;
            let agg;

            function toCols(agg) {
                let attr = agg.property;
                let prop = tools.resolvePath(agg.property, tokens);
                let ret = agg.method.toUpperCase() + "(" + prop + ")";
                let idx = attr.indexOf(".");
                let comp;

                if (idx === -1) {
                    subt.push(attr.toSnakeCase());
                } else {
                    comp = attr.slice(0, idx).toSnakeCase();
                    if (subt.indexOf(comp) !== -1) {
                        return ret; // Column already included;
                    }
                    subt.push(attr.slice(0, idx).toSnakeCase());
                }
                sub.push("%I");
                return ret;
            }

            // Validate
            obj.data.aggregations.forEach(function (agg) {
                if (methods.indexOf(agg.method) === -1) {
                    throw (
                        "Aggregation method " + agg.method +
                        " is unsupported"
                    );
                }
            });

            // Kick off query by getting feather, the rest falls through
            // callbacks
            feather = await feathers.getFeather({
                client: theClient,
                data: {name: obj.data.name}
            });

            if (!feather.name) {
                throw "Feather \"" + obj.name + "\" not found.";
            }

            table = feather.name.toSnakeCase();
            data.feather = feather;

            sql = (
                "SELECT to_json((" +
                obj.data.aggregations.map(toCols).toString(",") +
                ")) AS result FROM (" +
                "SELECT %I." + sub.toString(",").format(subt) + " FROM %I"
            );
            tokens.push(table);
            tokens.push(table);
            sql += await buildWhere(
                data,
                params,
                isSuperUser,
                feather.enableRowAuthorization
            );
            sql += ") AS data;";
            sql = sql.format(tokens);

            //console.log(sql, params);
            agg = await theClient.query(sql, params);
            return tools.sanitize(agg.rows[0]);
        };

        /**
            Perform soft delete on object records.

            @method doDelete
            @param {Object} payload Request payload
            @param {String} [payload.id] Id of record to delete
            @param {String | Object} [payload.client] Database client
            @param {Boolean} [payload.isHard] Hard delete flag. Default false.
            @param {Boolean} [isChild] Request as child. Default false.
            @param {Boolean} [isSuperUser] Request as super user. Default false.
            @return {Promise} Resolves `true` if successful
        */
        crud.doDelete = function (obj, ignore, isSuperUser) {
            return new Promise(function (resolve, reject) {
                let oldRec;
                let keys;
                let props;
                let noChildProps;
                let afterGetFeather;
                let afterAuthorization;
                let afterDoSelect;
                let afterDelete;
                let afterLog;
                let sql = "UPDATE object SET is_deleted = true WHERE id=$1;";
                let clen = 1;
                let c = 0;
                let theClient = db.getClient(obj.client);

                if (obj.isHard === true) {
                    sql = "DELETE FROM object WHERE id=$1;";
                }

                noChildProps = function (key) {
                    let t = props[key].type;

                    if (typeof t !== "object" || !t.childOf) {
                        return true;
                    }
                };

                afterGetFeather = function (feather) {
                    props = feather.properties;

                    if (isSuperUser === false) {
                        feathers.isAuthorized({
                            client: theClient,
                            data: {
                                id: obj.id,
                                action: "canDelete"
                            }
                        }).then(afterAuthorization).catch(reject);
                        return;
                    }

                    afterAuthorization(true);
                };

                afterAuthorization = function (authorized) {
                    if (!authorized) {
                        reject("Not authorized to delete \"" + obj.id + "\"");
                        return;
                    }

                    // Get old record, bail if it doesn't exist
                    // Exclude childOf relations when we select
                    crud.doSelect({
                        name: obj.name,
                        id: obj.id,
                        showDeleted: true,
                        properties: Object.keys(props).filter(noChildProps),
                        client: theClient,
                        callback: afterDoSelect,
                        sanitize: false
                    }, true).then(afterDoSelect).catch(reject);
                };

                afterDoSelect = function (resp) {
                    let eventKey = "_eventkey"; // JSLint no underscore
                    let msg;

                    oldRec = resp;

                    if (!oldRec) {
                        reject("Record " + obj.id + " not found.");
                        return;
                    }

                    if (oldRec.isDeleted) {
                        reject("Record " + obj.id + " already deleted.");
                        return;
                    }

                    if (
                        oldRec && oldRec.lock &&
                        oldRec.lock[eventKey] !== obj.eventKey
                    ) {
                        msg = "Record is locked by " + oldRec.lock.username;
                        msg += " and cannot be updated.";
                        reject(new Error(msg));
                        return;
                    }

                    // Get keys for properties of child arrays.
                    // Count expected callbacks along the way.
                    keys = Object.keys(props).filter(function (key) {
                        if (
                            typeof props[key].type === "object" &&
                            props[key].type.parentOf
                        ) {
                            clen += oldRec[key].length;
                            return true;
                        }
                    });

                    // Delete children recursively
                    keys.forEach(function (key) {
                        let rel = props[key].type.relation;
                        oldRec[key].forEach(function (row) {
                            crud.doDelete({
                                name: rel,
                                id: row.id,
                                client: theClient,
                                isHard: obj.isHard
                            }, true).then(afterDelete).catch(reject);
                        });
                    });

                    // Finally, delete parent object
                    theClient.query(sql, [obj.id], afterDelete);
                };

                // Handle change log
                afterDelete = function () {
                    // Move on only after all callbacks report back
                    c += 1;
                    if (c < clen) {
                        return;
                    }

                    afterLog();
                    return;

                    // Won't get here as code above prevents it
                    // TODO add flag in feather to make optional
                    /*
                    if (isChild || obj.isHard) {
                        afterLog();
                        return;
                    }

                    // Log the completed deletion
                    crud.doInsert({
                        name: "Log",
                        data: {
                            objectId: obj.id,
                            action: "DELETE",
                            created: now,
                            createdBy: now,
                            updated: now,
                            updatedBy: now
                        },
                        client: theClient
                    }, true).then(afterLog).catch(reject);
                    */
                };

                afterLog = function () {
                    resolve(true);
                };

                // Kick off query by getting feather, the rest falls
                // through callbacks
                feathers.getFeather({
                    client: theClient,
                    data: {
                        name: obj.name
                    }
                }).then(afterGetFeather).catch(reject);
            });
        };

        /**
            Insert records for a passed object.

            @method doInsert
            @param {Object} payload Request payload
            @param {String} payload.name Object type name
            @param {Object} payload.data Data to insert
            @param {String | Object} payload.client Database client
            @param {Boolean} [isChild] Request as child. Default false.
            @param {Boolean} [isSuperUser] Request as super user. Default false.
            @return {Promise} Resolves to array of patches reporting back
            differences between request and actual saved record result.
        */
        crud.doInsert = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
                let sql;
                let col;
                let key;
                let child;
                let pkey;
                let n;
                let dkeys;
                let fkeys;
                let len;
                let msg;
                let props;
                let prop;
                let value;
                let result;
                let afterGetFeather;
                let afterIdCheck;
                let afterNextVal;
                let afterAuthorized;
                let buildInsert;
                let afterGetPk;
                let afterHandleRelations;
                let insertChildren;
                let afterInsert;
                let afterDoSelect;
                let afterLog;
                let afterUniqueCheck;
                let feather;
                let payload;
                let data = f.copy(obj.data);
                let name = obj.name || "";
                let args = [name.toSnakeCase()];
                let tokens = [];
                let params = [];
                let values = [];
                let unique = false;
                let clen = 1;
                let c = 0;
                let p = 2;
                let theClient = db.getClient(obj.client);

                payload = {
                    data: {
                        name: obj.name
                    },
                    client: theClient
                };

                afterGetFeather = function (resp) {
                    let ovr;

                    if (!resp) {
                        reject("Class \"" + name + "\" not found");
                        return;
                    }

                    feather = resp;
                    props = f.copy(feather.properties);
                    fkeys = Object.keys(props);
                    dkeys = Object.keys(data);
                    ovr = feather.overloads || {};
                    // Take overload autonumber into account
                    Object.keys(ovr).some(function (key) {
                        if (ovr[key].autonumber) {
                            props[key].autonumber = ovr[key].autonumber;
                            return true;
                        }
                        return false;
                    });

                    /* Validate properties are valid */
                    len = dkeys.length;
                    for (n = 0; n < len; n += 1) {
                        if (fkeys.indexOf(dkeys[n]) === -1) {
                            msg = "Feather \"" + name;
                            msg += "\" does not contain property \"";
                            msg += dkeys[n] + "\"";
                            reject(new Error(msg));
                            return;
                        }
                    }

                    /* Check id for existence and uniqueness and regenerate
                       if needed */
                    if (!data.id) {
                        afterIdCheck(null, -1);
                        return;
                    }

                    tools.getKey({
                        id: data.id,
                        client: theClient
                    }, true).then(afterIdCheck).catch(reject);
                };

                afterIdCheck = function (id) {
                    if (id !== undefined) {
                        data.id = f.createId();
                    }

                    Object.keys(props).some(function (key) {
                        let fp = props[key];

                        if (fp.isNaturalKey && !fp.autonumber) {
                            unique = {
                                feather: fp.inheritedFrom || feather.name,
                                prop: key,
                                value: obj.data[key],
                                label: fp.alias || key
                            };

                            return true;
                        }

                        return false;
                    });

                    if (unique && !isChild) {
                        tools.getKeys({
                            client: theClient,
                            name: unique.feather,
                            filter: {
                                criteria: [{
                                    property: unique.prop,
                                    value: unique.value
                                }]
                            }
                        }).then(afterUniqueCheck).catch(reject);
                        return;
                    }

                    afterUniqueCheck();
                };

                afterUniqueCheck = function (resp) {
                    if (resp && resp.length) {
                        msg = "Value '" + unique.value + "' assigned to ";
                        msg += unique.label.toName() + " on ";
                        msg += feather.name.toName();
                        msg += " is not unique to data type ";
                        msg += unique.feather.toName() + ".";
                        reject(new Error(msg));
                        return;
                    }

                    if (!isChild && isSuperUser === false) {
                        feathers.isAuthorized({
                            client: theClient,
                            data: {
                                feather: name,
                                action: "canCreate"
                            }
                        }).then(afterAuthorized).catch(reject);
                        return;
                    }

                    afterAuthorized(true);
                };

                afterAuthorized = function (authorized) {
                    if (!authorized) {
                        msg = "Not authorized to create \"";
                        msg += obj.name + "\"";
                        reject({
                            statusCode: 401,
                            message: msg
                        });
                        return;
                    }

                    // Set some system controlled values
                    data.updated = f.now();
                    data.created = data.updated;
                    data.createdBy = theClient.currentUser();
                    data.updatedBy = theClient.currentUser();
                    data.isDeleted = false;
                    data.lock = null;

                    // Get primary key
                    sql = "select nextval('object__pk_seq')";
                    theClient.query(sql, afterNextVal);
                };

                afterNextVal = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    pkey = resp.rows[0].nextval;
                    values.push(pkey);

                    /* Build values */
                    len = fkeys.length;
                    n = 0;
                    buildInsert();
                };

                buildInsert = function () {
                    let callback;

                    if (n < len) {
                        key = fkeys[n];
                        child = false;
                        prop = props[key];
                        n += 1;
                        value = undefined;

                        /* Handle relations */
                        if (typeof prop.type === "object") {
                            if (prop.type.parentOf) {
                                /* To many */
                                child = true;

                                /* To one */
                            } else {
                                col = tools.relationColumn(
                                    key,
                                    prop.type.relation
                                );

                                if (
                                    data[key] === null ||
                                    data[key] === undefined
                                ) {
                                    if (
                                        prop.default !== undefined && (
                                            prop.default !== null ||
                                            prop.type === "object" ||
                                            prop.type === "array" ||
                                            prop.format === "date" ||
                                            prop.format === "dateTime"
                                        )
                                    ) {
                                        data[key] = prop.default;
                                    } else if (prop.isRequired !== true) {
                                        value = -1;
                                    } else {
                                        msg = "Property " + key;
                                        msg += " is required on ";
                                        msg += feather.name + ".";
                                        reject(new Error(msg));
                                        return;
                                    }
                                }
                                if (value !== -1) {
                                    if (prop.type.isChild) {
                                        /* Insert child relation on the fly */
                                        crud.doInsert({
                                            name: prop.type.relation,
                                            data: data[key],
                                            client: theClient
                                        }, true, true).then(function () {
                                            tools.getKey({
                                                id: data[key].id,
                                                client: theClient
                                            }).then(afterGetPk).catch(reject);
                                        }).catch(reject);
                                        return;
                                    }

                                    /* Relation must already exist */
                                    if (prop.type.childOf && obj.pk) {
                                        afterGetPk(obj.pk);
                                    } else {
                                        tools.getKey({
                                            id: data[key].id,
                                            client: theClient
                                        }).then(afterGetPk).catch(reject);
                                    }
                                    return;
                                }
                            }

                            /* Handle discriminator */
                        } else if (key === "objectType") {
                            child = true;

                            /* Handle regular types */
                        } else {
                            value = data[key];
                            col = key.toSnakeCase();

                            // Handle objects whose values are actually strings
                            if (
                                prop.type === "object" &&
                                typeof value === "string" &&
                                value.slice(0, 1) !== "["
                            ) {
                                value = "\"" + value + "\"";
                            } else if (prop.type === "array") {
                                value = JSON.stringify(value);
                            }

                            // Handle autonumber
                            if (
                                !value &&
                                prop.autonumber
                            ) {
                                callback = function (err, resp) {
                                    let seq = resp.rows[0].seq - 0;

                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    value = prop.autonumber.prefix || "";
                                    value += seq.pad(prop.autonumber.length);
                                    value += prop.autonumber.suffix || "";
                                    afterHandleRelations();
                                };

                                theClient.query(
                                    "SELECT nextval($1) AS seq",
                                    [prop.autonumber.sequence],
                                    callback
                                );
                                return;
                            }

                            // Handle other types of defaults
                            if (value === undefined) {
                                if (
                                    prop.default !== undefined
                                ) {
                                    value = prop.default;
                                } else if (
                                    prop.format &&
                                    formats[prop.format] &&
                                    formats[prop.format].default !== undefined
                                ) {
                                    value = formats[prop.format].default;
                                } else {
                                    value = tools.types[prop.type].default;
                                }

                                // If we have a class specific default that
                                // calls a function
                                if (
                                    typeof value === "string" &&
                                    value.match(/\(\)$/)
                                ) {
                                    value = f[value.replace(/\(\)$/, "")]();

                                    if (value.constructor.name === "Promise") {
                                        Promise.all([value]).then(
                                            function (resp) {
                                                value = resp[0];
                                                afterHandleRelations();
                                            }
                                        ).catch(
                                            reject
                                        );
                                        return;
                                    }
                                }
                            }
                        }

                        afterHandleRelations();
                        return;
                    }

                    sql = (
                        "INSERT INTO %I (_pk, " + tokens.toString(",") +
                        ") VALUES ($1," + params.toString(",") + ");"
                    );
                    sql = sql.format(args);

                    // Insert children first so notification gets full object
                    insertChildren();
                };

                afterGetPk = function (id) {
                    value = id;

                    if (value === undefined) {
                        msg = "Relation not found in \"";
                        msg += prop.type.relation;
                        msg += "\" for \"" + key + "\" with id \"";
                        msg += data[key].id + "\"";
                        reject(new Error(msg));
                        return;
                    }

                    if (!isChild && prop.type.childOf) {
                        msg = "Child records may only be created from the";
                        msg += " parent.";
                        reject(new Error(msg));
                        return;
                    }

                    afterHandleRelations();
                };

                afterHandleRelations = function () {
                    if (!child) {
                        if (prop.isRequired && value === null) {
                            msg = "\"" + key + "\" is required on ";
                            msg += feather.name + ".";
                            reject(new Error(msg));
                            return;
                        }

                        /* Handle non-relational composites */
                        if (
                            prop.type === "object" &&
                            formats[prop.format] &&
                            formats[prop.format].isMoney
                        ) {
                            Object.keys(value || {}).forEach(function (attr) {
                                args.push(col);
                                args.push(attr.toSnakeCase());
                                tokens.push("%I.%I");
                                values.push(value[attr.toSnakeCase()]);
                                params.push("$" + p);
                                p += 1;
                            });
                            buildInsert();
                            return;
                        }

                        /* Handle everything else */
                        args.push(col);
                        tokens.push("%I");
                        values.push(value);
                        params.push("$" + p);
                        p += 1;
                    }

                    buildInsert();
                };

                insertChildren = function (err) {
                    let ckeys;

                    if (err) {
                        reject(err);
                        return;
                    }

                    // Get keys for properties of child arrays.
                    // Count expected callbacks along the way.
                    ckeys = Object.keys(props).filter(function (key) {
                        if (
                            typeof props[key].type === "object" &&
                            props[key].type.parentOf &&
                            data[key] !== undefined
                        ) {
                            clen += data[key].length;
                            return true;
                        }
                    });

                    // Insert children recursively
                    ckeys.forEach(function (key) {
                        let rel = props[key].type.relation;

                        data[key].forEach(function (row) {
                            row[props[key].type.parentOf] = {
                                id: data.id
                            };
                            crud.doInsert({
                                pk: pkey,
                                name: rel,
                                data: row,
                                client: theClient
                            }, true).then(afterInsert).catch(reject);
                        });
                    });

                    afterInsert();
                };

                afterInsert = function () {
                    function afterParentInsert() {
                        // We're done here if child
                        if (isChild) {
                            resolve(result);
                            return;
                        }

                        // Otherwise move on to log the change
                        crud.doSelect({
                            name: obj.name,
                            id: data.id,
                            client: theClient
                        }).then(afterDoSelect).catch(reject);
                    }

                    // Done only when all callbacks report back
                    c += 1;
                    if (c < clen) {
                        return;
                    }

                    // Perform the parent insert
                    theClient.query(sql, values).then(
                        afterParentInsert
                    ).catch(
                        reject
                    );
                };

                afterDoSelect = function (resp) {
                    result = resp;
                    afterLog();
                    return;

                    // Won't get here because of above
                    // TODO: make logging optional
                    /* Handle change log */
                    /*
                    crud.doInsert({
                        name: "Log",
                        data: {
                            objectId: data.id,
                            action: "POST",
                            created: data.created,
                            createdBy: data.createdBy,
                            updated: data.updated,
                            updatedBy: data.updatedBy,
                            change: f.copy(result)
                        },
                        client: theClient
                    }, true).then(afterLog).catch(reject);
                    */
                };

                afterLog = function () {
                    // We're going to return the changes
                    result = jsonpatch.compare(obj.cache, result);

                    // Update newRec for "trigger after" events
                    if (obj.newRec) {
                        jsonpatch.applyPatch(obj.newRec, result);
                    }

                    // Report back result
                    resolve(result);
                };

                // Kick off query by getting feather, the rest falls
                // through callbacks
                feathers.getFeather(payload).then(
                    afterGetFeather
                ).catch(
                    reject
                );
            });
        };

        /**
            Select records for an object based on payload id or an
            array of objects if no id protheIded.

            @method doSelect
            @param {Object} payload Request payload
            @param {String} [payload.id] Id of record to select
            @param {String} payload.name Name of feather
            @param {Object} [payload.filter] Filter criteria of records to
            select
            @param {Array} [payload.properties] Array of properties to include.
            If not specified, all properties will be returned.
            @param {String | Object} payload.client Database client
            @param {Boolean} [payload.showDeleted] include deleted records
            @param {Object} [payload.subscription] subscribe to events on
            results
            @param {Boolean} [payload.sanitize] sanitize result. Default true
            @param {Boolean} [payload.isForUpdate] Apply an update lock
            @param {Boolean} [isChild] Request as child. Default false.
            @param {Boolean} [isSuperUser] Request as super user. Default false.
            @return {Promise} Resolves to object or array.
        */
        crud.doSelect = async function (obj, ignore, isSuperUser) {
            let sql;
            let table;
            let key;
            let keys;
            let tokens = [];
            let cols = [];
            let theClient = db.getClient(obj.client);
            let feather;
            let attrs = [];
            let fp;
            let result;
            let payload = {
                name: obj.name,
                client: theClient,
                showDeleted: obj.showDeleted
            };

            function mapKeys(row) {
                let rkeys;
                let ret = {};
                let i = 0;

                if (typeof row.result === "object") {
                    rkeys = Object.keys(row.result);
                    rkeys.forEach(function (key) {
                        ret[keys[i]] = row.result[key];
                        i += 1;
                    });

                    // If only one attribute returned
                } else {
                    ret[keys[0]] = row.result;
                }

                return ret;
            }

            // Kick off query by getting feather
            feather = await feathers.getFeather({
                client: theClient,
                data: {name: obj.name}
            });

            fp = feather.properties;

            if (!feather.name) {
                throw new Error("Feather \"" + obj.name + "\" not found.");
            }

            payload.feather = feather;
            table = "_" + feather.name.toSnakeCase();

            // Strip dot notation. Just fetch whole relation
            if (obj.properties) {
                obj.properties = obj.properties.map(function (p) {
                    let i = p.indexOf(".");
                    let ret = p;

                    if (i !== -1) {
                        ret = p.slice(0, i);
                        if (attrs.indexOf(ret) !== -1) {
                            ret = undefined;
                        }
                        attrs.push(ret);
                    }
                    attrs.push(ret);
                    return ret;
                }).filter(function (p) {
                    return p !== undefined;
                });
            }

            keys = obj.properties || Object.keys(
                fp
            ).filter(function (key) {
                return (
                    typeof fp[key].type !== "object" ||
                    fp[key].type.childOf === undefined ||
                    (
                        fp[key].type.childOf &&
                        fp[key].type.properties &&
                        fp[key].type.properties.length
                    )
                );
            });

            keys.forEach(function (key) {
                tokens.push("%I");
                cols.push(key.toSnakeCase());
            });

            cols.push(table);
            sql = (
                "SELECT to_json((" + tokens.toString(",") +
                ")) AS result FROM %I"
            );
            sql = sql.format(cols);

            /* Get one result by key */
            payload.rowAuth = feather.enableRowAuthorization;
            if (obj.id) {
                payload.id = obj.id;
                key = await tools.getKey(
                    payload,
                    isSuperUser
                );

                // Either unauthorized, or bad id
                if (key === undefined) {
                    return undefined;
                }

                sql += " WHERE id = $1";

                if (obj.isForUpdate) {
                    sql += " FOR UPDATE";
                }

                result = await theClient.query(sql, [obj.id]);
                result = mapKeys(result.rows[0]);
                if (obj.sanitize !== false) {
                    result = tools.sanitize(result);
                }

                return result;

                /* Get a filtered result */
            } else {
                payload.filter = obj.filter;

                isSuperUser = isSuperUser !== false;
                // Subselect to get primary keys (gk)
                let gksql = "SELECT %I._pk FROM %I";
                let gktbl = obj.name.toSnakeCase();
                let params = [];

                gksql = gksql.format([gktbl, gktbl]);
                gksql += await buildWhere(
                    payload,
                    params,
                    isSuperUser,
                    feather.enableRowAuthorization
                );

                let feathername;
                let sort = (
                    obj.filter
                    ? obj.filter.sort || []
                    : []
                );

                sql += " WHERE _pk IN (";
                sql += gksql;
                sql += ")";

                tokens = [];
                sql += tools.processSort(sort, tokens);
                sql = sql.format(tokens);

                if (obj.isForUpdate) {
                    sql += " FOR UPDATE";
                }

                //console.log(sql, params);
                result = await theClient.query(sql, params);
                result = tools.sanitize(result.rows.map(mapKeys));

                if (
                    !obj.filter || (
                        !obj.filter.criteria &&
                        !obj.filter.limit
                    )
                ) {
                    feathername = obj.name;
                }

                // Handle subscription
                await events.subscribe(
                    theClient,
                    obj.subscription,
                    result.map((item) => item.id),
                    feathername
                );

                return result;
            }
        };

        /**
            Update records based on patch definition.

            @method doUpdate
            @param {Object} payload Request payload
            @param {String} payload.id Id of record to update
            @param {Object} payload.data Patch to apply
            @param {String | Object} payload.client Database client
            @param {Boolean} [isChild] Request as child. Default false.
            @param {Boolean} [isSuperUser] Request as super user. Default
            false.
            @return {Promise} Resolves to array of patches reporting back
            differences between request and actual saved record result.
        */
        crud.doUpdate = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
                let result;
                let updRec;
                let props;
                let value;
                let sql;
                let pk;
                let relation;
                let key;
                let keys;
                let oldRec;
                let newRec;
                let cpatches;
                let feather;
                let tokens;
                let afterGetKey;
                let afterDoSelect;
                let afterUpdate;
                let afterSelectUpdated;
                let done;
                let nextProp;
                let afterProperties;
                let afterUniqueCheck;
                let unique;
                let doUnlock;
                let afterGetRelKey;
                let cacheRec;
                let patches = obj.data || [];
                let theId = obj.id;
                let doList = [];
                let params = [];
                let ary = [];
                let clen = 0;
                let children = [];
                let p = 1;
                let n = 0;
                let theClient = db.getClient(obj.client);

                if (!patches.length) {
                    crud.unlock(theClient, {
                        id: obj.id
                    }).then(resolve.bind(null, [])).catch(reject);
                    return;
                }

                function find(ary, id) {
                    return ary.filter(function (item) {
                        return item && item.id === id;
                    })[0] || false;
                }

                function noChildProps(key) {
                    if (
                        typeof feather.properties[key].type !== "object" ||
                        !feather.properties[key].type.childOf
                    ) {
                        return true;
                    }
                }

                function afterAuthorization(authorized) {
                    if (!authorized) {
                        reject("Not authorized to update \"" + theId + "\"");
                        return;
                    }

                    tools.getKey({
                        id: theId,
                        client: theClient
                    }).then(afterGetKey).catch(reject);
                }

                function afterGetFeather(resp) {
                    if (!resp) {
                        reject("Feather \"" + obj.name + "\" not found.");
                        return;
                    }

                    feather = resp;
                    tokens = [feather.name.toSnakeCase()];
                    props = feather.properties;

                    if (isSuperUser === false) {
                        feathers.isAuthorized({
                            client: theClient,
                            data: {
                                id: theId,
                                action: "canUpdate"
                            }
                        }).then(afterAuthorization).catch(reject);
                        return;
                    }

                    afterAuthorization(true);
                }

                afterGetKey = function (resp) {
                    pk = resp;
                    keys = Object.keys(props);

                    // Get existing record
                    crud.doSelect({
                        name: obj.name,
                        id: obj.id,
                        properties: keys.filter(noChildProps),
                        client: theClient,
                        sanitize: false
                    }, isChild).then(afterDoSelect).catch(reject);
                };

                afterDoSelect = function (resp) {
                    let eventKey = "_eventkey"; // JSLint no underscore
                    let msg;

                    function requiredIsNull(fkey) {
                        if (props[fkey].isRequired && updRec[fkey] === null) {
                            key = fkey;
                            return true;
                        }
                    }

                    function uniqueChanged(fkey) {
                        let pf = props[fkey];

                        if (
                            pf.isNaturalKey &&
                            updRec[fkey] !== oldRec[fkey] &&
                            !isChild // Children can be reordered
                        ) {

                            unique = {
                                feather: pf.inheritedFrom || feather.name,
                                prop: fkey,
                                value: updRec[fkey],
                                label: pf.alias || fkey
                            };

                            return true;
                        }
                    }

                    if (
                        resp && resp.lock &&
                        resp.lock[eventKey] !== obj.eventKey
                    ) {
                        msg = "Record is locked by ";
                        msg += resp.lock.username;
                        msg += " and cannot be updated.";
                        reject(new Error(msg));
                        return;
                    }

                    oldRec = tools.sanitize(resp);

                    if (!Object.keys(oldRec).length || oldRec.isDeleted) {
                        resolve(false);
                        return;
                    }

                    newRec = f.copy(oldRec);
                    jsonpatch.applyPatch(newRec, patches);

                    // Capture changes from original request
                    if (obj.cache) {
                        cacheRec = f.copy(oldRec);
                        jsonpatch.applyPatch(cacheRec, obj.cache);
                    }

                    if (!patches.length) {
                        afterUpdate();
                        return;
                    }

                    updRec = f.copy(newRec);

                    // Revert data that may not be updated directly
                    updRec.created = oldRec.created;
                    updRec.createdBy = oldRec.createdBy;
                    updRec.updated = new Date().toJSON();
                    updRec.updatedBy = theClient.currentUser();
                    updRec.isDeleted = false;
                    updRec.lock = oldRec.lock;

                    if (props.etag) {
                        updRec.etag = f.createId();
                    }

                    // Check required properties
                    if (keys.some(requiredIsNull)) {
                        reject("\"" + key + "\" is required.");
                        return;
                    }

                    // Check unique properties
                    if (keys.some(uniqueChanged)) {
                        tools.getKeys({
                            client: theClient,
                            name: unique.feather,
                            filter: {
                                criteria: [{
                                    property: unique.prop,
                                    value: unique.value
                                }]
                            }
                        }).then(afterUniqueCheck).catch(reject);
                        return;
                    }

                    // Process properties
                    nextProp();
                };

                afterUniqueCheck = function (resp) {
                    let msg;

                    if (resp && resp.length) {
                        msg = "Value '" + unique.value + "' assigned to ";
                        msg += unique.label.toName() + " on ";
                        msg += feather.name.toName();
                        msg += " is not unique to data type ";
                        msg += unique.feather.toName() + ".";
                        reject(new Error(msg));
                        return;
                    }

                    nextProp();
                };

                nextProp = function () {
                    let updProp;
                    let oldProp;
                    let msg;

                    key = keys[n];
                    n += 1;

                    if (n <= keys.length) {
                        /* Handle composite types */
                        if (typeof props[key].type === "object") {
                            updProp = updRec[key] || {};
                            oldProp = oldRec[key] || {};

                            /* Handle child records */
                            if (Array.isArray(updRec[key])) {
                                relation = props[key].type.relation;

                                /* Process deletes */
                                oldRec[key].forEach(function (row) {
                                    let cid = row.id;

                                    if (!find(updRec[key], cid)) {
                                        clen += 1;
                                        doList.push({
                                            func: crud.doDelete,
                                            payload: {
                                                name: relation,
                                                id: cid,
                                                client: theClient
                                            }
                                        });
                                    }
                                });

                                /* Process inserts and updates */
                                updRec[key].forEach(function (cNewRec) {
                                    if (!cNewRec) {
                                        return;
                                    }

                                    let cid = cNewRec.id || null;
                                    let cOldRec = find(oldRec[key], cid);

                                    if (cOldRec) {
                                        cpatches = jsonpatch.compare(
                                            cOldRec,
                                            cNewRec
                                        );

                                        if (cpatches.length) {
                                            clen += 1;
                                            doList.push({
                                                func: crud.doUpdate,
                                                payload: {
                                                    name: relation,
                                                    id: cid,
                                                    data: cpatches,
                                                    client: theClient
                                                }
                                            });
                                        }
                                    } else {
                                        cNewRec[props[key].type.parentOf] = {
                                            id: updRec.id
                                        };
                                        clen += 1;
                                        doList.push({
                                            func: crud.doInsert,
                                            payload: {
                                                name: relation,
                                                data: cNewRec,
                                                client: theClient
                                            }
                                        });
                                    }
                                });

                            /* Handle child relation updates */
                            } else if (props[key].type.isChild) {
                                /* Do delete */
                                if (oldRec[key] && !updRec[key]) {
                                    crud.doDelete({
                                        eventKey: obj.eventKey,
                                        name: props[key].type.relation,
                                        id: oldRec[key].id,
                                        client: theClient,
                                        isHard: true
                                    }, true, true).then(function () {
                                        afterGetRelKey(null, -1);
                                    }).catch(reject);

                                    return;
                                }

                                /* Do insert */
                                if (updRec[key] && !oldRec[key]) {
                                    crud.doInsert({
                                        name: props[key].type.relation,
                                        id: updRec[key].id,
                                        data: updRec[key],
                                        client: theClient
                                    }, true, true).then(function () {
                                        tools.getKey({
                                            id: updRec[key].id,
                                            client: theClient
                                        }).then(
                                            afterGetRelKey
                                        ).catch(
                                            reject
                                        );
                                    }).catch(reject);

                                    return;
                                }

                                if (
                                    updRec[key] && oldRec[key] &&
                                    updRec[key].id !== oldRec[key].id
                                ) {
                                    msg = "Id cannot be changed on child";
                                    msg += "relation '" + key + "'";
                                    reject(new Error(msg));
                                    return;
                                }

                                /* Do update */
                                cpatches = jsonpatch.compare(
                                    oldRec[key] || {},
                                    updRec[key] || {}
                                );

                                if (cpatches.length) {
                                    crud.doUpdate({
                                        eventKey: obj.eventKey,
                                        name: props[key].type.relation,
                                        id: updRec[key].id,
                                        data: cpatches,
                                        client: theClient
                                    }, true, true).then(function () {
                                        tools.getKey({
                                            id: updRec[key].id,
                                            client: theClient
                                        }).then(
                                            afterGetRelKey
                                        ).catch(
                                            reject
                                        );
                                    }).catch(reject);
                                    return;
                                }

                                nextProp();
                                return;
                            }

                            /* Handle regular to one relations */
                            if (
                                !props[key].type.childOf &&
                                updProp.id !== oldProp.id
                            ) {

                                if (updProp.id) {
                                    tools.getKey({
                                        id: updRec[key].id,
                                        client: theClient
                                    }).then(afterGetRelKey).catch(reject);
                                } else {
                                    afterGetRelKey(null, -1);
                                }
                                return;
                            }

                            /* Handle non-relational composites */
                        } else if (
                            updRec[key] !== oldRec[key] &&
                            props[key].type === "object" &&
                            formats[props[key].format] &&
                            formats[props[key].format].isMoney
                        ) {

                            Object.keys(updRec[key]).forEach(
                                function (attr) {
                                    tokens.push(key.toSnakeCase());
                                    tokens.push(attr.toSnakeCase());
                                    ary.push("%I.%I = $" + p);
                                    params.push(updRec[key][attr]);
                                    p += 1;
                                }
                            );

                            /* Handle regular data types */
                        } else if (
                            updRec[key] !== oldRec[key] && key !== "objectType"
                        ) {

                            // Handle objects whose values are actually
                            // strings
                            if (
                                props[key].type === "object" &&
                                typeof updRec[key] === "string" &&
                                updRec[key].slice(0, 1) !== "["
                            ) {
                                updRec[key] = "\"" + updRec[key] + "\"";
                            } else if (props[key].type === "array") {
                                updRec[key] = JSON.stringify(updRec[key]);
                            }

                            tokens.push(key.toSnakeCase());
                            ary.push("%I = $" + p);
                            params.push(updRec[key]);
                            p += 1;
                        }

                        nextProp();
                        return;
                    }

                    // Done, move on
                    afterProperties();
                };

                afterGetRelKey = function (resp) {
                    let msg;

                    value = resp;
                    relation = props[key].type.relation;

                    if (value === undefined) {
                        msg = "Relation not found in \"";
                        msg += relation + "\" for \"" + key;
                        msg += "\" with id \"" + updRec[key].id + "\"";
                        reject(new Error(msg));
                        return;
                    }

                    tokens.push(tools.relationColumn(key, relation));
                    ary.push("%I = $" + p);
                    params.push(value);
                    p += 1;

                    nextProp();
                };

                afterProperties = function () {
                    // Execute child changes first so all captured in any
                    // notification
                    children = doList.map(
                        (item) => item.func(item.payload, true)
                    );

                    // Execute top level object change
                    sql = (
                        "UPDATE %I SET " + ary.join(",") +
                        " WHERE _pk = $" + p
                    );
                    sql = sql.format(tokens);
                    params.push(pk);
                    clen += 1;

                    Promise.all(children).then(
                        () => theClient.query(sql, params)
                    ).then(
                        afterUpdate
                    ).catch(
                        reject
                    );
                };

                afterUpdate = function () {
                    // If child, we're done here
                    if (isChild) {
                        resolve();
                        return;
                    }

                    // If a top level record, return patch of what changed
                    crud.doSelect({
                        name: feather.name,
                        id: theId,
                        client: theClient
                    }).then(afterSelectUpdated).catch(reject);
                };

                afterSelectUpdated = function (resp) {
                    result = resp;

                    doUnlock();
                    return;

                    // Won't get here because of above
                    // TODO: Make logging optional
                    // Handle change log
                    /*
                    if (updRec) {
                        crud.doInsert({
                            name: "Log",
                            data: {
                                objectId: id,
                                action: "PATCH",
                                created: updRec.updated,
                                createdBy: updRec.updatedBy,
                                updated: updRec.updated,
                                updatedBy: updRec.updatedBy,
                                change: JSON.stringify(jsonpatch.compare(
                                    oldRec,
                                    result
                                ))
                            },
                            client: theClient
                        }, true).then(doUnlock).catch(reject);
                        return;
                    }
                    doUnlock();
                    */
                };

                doUnlock = function () {
                    crud.unlock(theClient, {
                        id: obj.id
                    }).then(
                        done
                    ).catch(
                        reject
                    );
                };

                done = function () {
                    let ret = jsonpatch.compare(cacheRec, result);

                    // Update newRec for "trigger after" use if applicable
                    if (obj.newRec) {
                        jsonpatch.applyPatch(obj.newRec, ret);
                    }

                    ret = ret.filter(
                        (r) => r.path.slice(r.path.length - 5) !== "/lock"
                    );

                    // Send back the differences between what user asked
                    // for and result
                    resolve(ret);
                };

                // Kick off query by getting feather, the rest falls
                // through callbacks
                feathers.getFeather({
                    client: theClient,
                    data: {
                        name: obj.name
                    }
                }).then(afterGetFeather).catch(reject);
            });
        };

        /**
            Lock a record to prevent others from editing.

            @method lock
            @param {Object} client Database client connection id
            @param {String} nodeId Node id.
            @param {String} id Record id
            @param {String} username
            @param {String} eventKey
            @param {String} [process] Description of lock reason
            @return {Promise} Resolves to `true` if successful.
        */
        crud.lock = function (client, nodeid, id, username, eventkey, process) {
            process = process || "Editing";
            return new Promise(function (resolve, reject) {
                let msg;

                if (!nodeid) {
                    reject(new Error("Lock requires a node id."));
                    return;
                }

                if (!eventkey) {
                    reject(new Error("Lock requires an eventkey."));
                    return;
                }

                if (!id) {
                    reject(new Error("Lock requires an object id."));
                    return;
                }

                if (!username) {
                    reject(new Error("Lock requires a username."));
                    return;
                }

                function checkLock() {
                    return new Promise(function (resolve, reject) {
                        let sql = (
                            "SELECT to_json(lock) AS lock " +
                            "FROM object WHERE id = $1"
                        );

                        function callback(resp) {
                            if (!resp.rows.length) {
                                msg = "Record " + id + " not found.";
                                reject(new Error(msg));
                                return;
                            }

                            if (
                                resp.rows[0].lock &&
                                resp.rows[0].lock[ekey] !== eventkey
                            ) {
                                msg = "Record " + id + " is already locked.";
                                reject(new Error(msg));
                                return;
                            }

                            resolve();
                        }

                        client.query(sql, [id]).then(
                            callback
                        ).catch(
                            reject
                        );
                    });
                }

                function doLock() {
                    return new Promise(function (resolve, reject) {
                        let params;
                        let sql;

                        sql = (
                            "UPDATE object " +
                            "SET lock = ROW($1, now(), $2, $3, $4) " +
                            "WHERE id = $5"
                        );

                        function callback() {
                            resolve(true);
                        }

                        params = [
                            username,
                            nodeid,
                            eventkey,
                            process,
                            id
                        ];

                        client.query(sql, params).then(
                            callback
                        ).catch(
                            reject
                        );
                    });
                }

                Promise.resolve().then(
                    checkLock
                ).then(
                    doLock
                ).then(
                    resolve
                ).catch(
                    reject
                );

            });
        };

        /**
            Unlock object(s) by type. At least one criteria must be protheIded.

            @method unlock
            @param {Object} client Database client connection id
            @param {Object} criteria Criteria for what to unlock.
            @param {String} [criteria.id] Object id.
            @param {String} [criteria.username] User name.
            @param {String} [criteria.eventKey] Browser instance key.
            @param {String} [criteria.nodeId] Node id.
            @return {Promise} Resolves to array of ids unlocked.
        */
        crud.unlock = function (client, criteria) {
            return new Promise(function (resolve, reject) {
                let sql;
                let params = [];

                function callback(resp) {
                    resolve(resp.rows);
                }

                sql = "UPDATE object SET lock = NULL WHERE true ";

                if (criteria.id) {
                    params.push(criteria.id);
                    sql += " AND object.id = $1";
                }

                if (criteria.username) {
                    params.push(criteria.username);
                    sql += " AND username(lock) = $" + params.length;
                }

                if (criteria.eventKey) {
                    params.push(criteria.eventKey);
                    sql += " AND _eventkey(lock) = $" + params.length;
                }

                if (criteria.nodeId) {
                    params.push(criteria.nodeId);
                    sql += " AND _nodeid(lock) = $" + params.length;
                }

                if (!params.length) {
                    reject(new Error("No lock criteria defined."));
                    return;
                }

                sql += " RETURNING id; ";

                client.query(sql, params).then(
                    callback
                ).catch(
                    reject
                );
            });
        };

        /**
            Return next autonumber value for feather.

            @method autonumber
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data Data
            @param {String} payload.data.name Feather name
            @return {Promise} Resolves number string.
        */
        crud.autonumber = function (obj) {
            let prop;
            let theClient = db.getClient(obj.client);

            return new Promise(function (resolve, reject) {
                function callback(err, resp) {
                    let seq = resp.rows[0].seq - 0;
                    let value;

                    if (err) {
                        reject(err);
                        return;
                    }

                    value = prop.autonumber.prefix || "";
                    value += seq.pad(prop.autonumber.length);
                    value += prop.autonumber.suffix || "";
                    resolve(value);
                }

                function nextVal(feather) {
                    let pname = "properties";
                    let attr = Object.keys(
                        feather.properties
                    ).find(function (key) {
                        return feather.properties[key].autonumber;
                    });
                    // Check overloads
                    if (!attr) {
                        pname = "overloads";
                        attr = Object.keys(
                            feather.overloads
                        ).find(function (key) {
                            return feather.overloads[key].autonumber;
                        });
                    }

                    if (!attr) {
                        reject(
                            "Autonumber property not found on feather " +
                            obj.data.name
                        );
                        return;
                    }
                    prop = feather[pname][attr];
                    theClient.query(
                        "SELECT nextval($1) AS seq",
                        [prop.autonumber.sequence],
                        callback
                    );
                }

                feathers.getFeather({
                    client: theClient,
                    data: {name: obj.data.name}
                }).then(nextVal).catch(reject);
            });
        };

        return crud;
    };

}(exports));

