/*
    Framework for building object relational database apps
    Copyright (C) 2021  John Rogelstad

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
/*jslint node, this, for, devel*/

/**
    Text output generator.
    @module Stringify
*/
(function (exports) {
    "use strict";

    const f = require("../../common/core");
    const {CRUD} = require("./crud");
    const {Feathers} = require("./feathers");
    const Table = require("../../node_modules/table-layout/dist/index.js");
    const crud = new CRUD();
    const feathers = new Feathers();
    //const COL_WIDTH_DEFAULT = 150;
    const exclusions = [
        "id",
        "isDeleted",
        "lock",
        "created",
        "createdBy",
        "updated",
        "updatedBy",
        "objectType",
        "etag",
        "owner"
    ];

    function buildForm(feather, localFeathers) {
        let props;
        let keys;
        let found;
        let theAttrs = [];

        props = f.copy(feather.properties);
        keys = Object.keys(props);

        // Make sure key attributes are first
        found = keys.find((key) => props[key].isNaturalKey);
        if (found) {
            theAttrs.push({attr: found});
            keys.splice(keys.indexOf(found), 1);
        }

        found = keys.find((key) => props[key].isLabelKey);
        if (found) {
            theAttrs.push({attr: found});
            keys.splice(keys.indexOf(found), 1);
        }

        // Build config with remaining keys
        keys.forEach(function (key) {
            let value = {attr: key};
            let p;
            let k;

            if (exclusions.indexOf(key) !== -1) {
                return;
            }

            if (
                props[key].type === "object" &&
                !props[key].format
            ) {
                return;
            }

            if (
                typeof props[key].type === "object" && (
                    props[key].type.childOf || props[key].type.parentOf
                )
            ) {
                p = localFeathers[props[key].type.relation].properties;
                k = Object.keys(p);
                k = k.filter(function (key) {
                    return (
                        exclusions.indexOf(key) === -1 &&
                        (typeof p[key] !== "object" || !p[key].type.childOf)
                    );
                });
                value.columns = k.map(function (key) {
                    return {attr: key};
                });
                value.height = "200px";
            }

            theAttrs.push(value);
        });

        theAttrs.forEach(function (a) {
            a.grid = 0;
            a.unit = 0;
            a.label = "";
            a.showLabel = true;
            a.columns = a.columns || [];
        });
        return {
            attrs: theAttrs,
            tabs: []
        };
    }

    function doGetFeather(client, featherName, localFeathers, idx) {
        return new Promise(function (resolve, reject) {
            idx = idx || [];

            // avoid infinite loops
            if (idx.indexOf(featherName) !== -1) {
                resolve();
                return;
            }
            idx.push(featherName);

            function getChildFeathers(resp) {
                let frequests = [];
                let props = resp.properties;

                try {
                    localFeathers[featherName] = resp;

                    // Recursively get feathers for all children
                    Object.keys(props).forEach(function (key) {
                        let type = props[key].type;

                        if (
                            typeof type === "object"
                        ) {
                            frequests.push(
                                doGetFeather(
                                    client,
                                    type.relation,
                                    localFeathers,
                                    idx
                                )
                            );
                        }
                    });
                } catch (e) {
                    reject(e);
                    return;
                }

                Promise.all(
                    frequests
                ).then(resolve).catch(reject);
            }

            feathers.getFeather({
                client,
                data: {
                    name: featherName
                }
            }).then(getChildFeathers).catch(reject);
        });
    }

    /**
        @class Stringify
        @constructor
        @namespace Services
    */
    exports.Stringify = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Create formatted text output based on form definition.

            @method printForm
            @param {Object} payload
            @param {Object} payload.client Database client
            @param {Object} payload.data Payload data
            @param {String} payload.data.form Form name
            @param {String | Array} payload.data.ids Record Id or Id array
            @return {String} Formatted text
        */
        that.printForm = function (obj) {
            return new Promise(function (resolve, reject) {
                if (!Array.isArray(obj.data.ids)) {
                    obj.data.ids = [obj.data.ids];
                }
                let requests = [];
                let rows;
                let currs;
                let localFeathers = {};
                let vClient = obj.client;
                let form = obj.data.form;
                let ids = obj.data.ids;

                function getForm() {
                    return new Promise(function (resolve, reject) {
                        crud.doSelect({
                            name: "Form",
                            client: vClient,
                            filter: {
                                criteria: [{
                                    property: "name",
                                    value: form
                                }]
                            }
                        }, false, true).then(resolve).catch(reject);
                    });
                }

                function getFeather(resp) {
                    return new Promise(function (resolve, reject) {
                        rows = resp[0];
                        currs = resp[1];

                        if (!rows.length) {
                            reject("Data not found");
                            return;
                        }
                        if (form) {
                            if (!resp[2][0]) {
                                reject("Form " + form + " not found");
                                return;
                            }

                            if (!resp[2][0].isActive) {
                                reject("Form " + form + " is not active");
                                return;
                            }
                            form = resp[2][0];
                        }

                        doGetFeather(
                            vClient,
                            rows[0].objectType,
                            localFeathers
                        ).then(resolve).catch(reject);
                    });
                }

                function getData() {
                    return new Promise(function (resolve, reject) {
                        function callback(resp) {
                            crud.doSelect({
                                name: resp.objectType,
                                client: vClient,
                                user: vClient.currentUser(),
                                filter: {
                                    criteria: [{
                                        property: "id",
                                        operator: "IN",
                                        value: ids
                                    }]
                                }
                            }).then(resolve).catch(reject);
                        }

                        crud.doSelect({
                            name: "Object",
                            client: vClient,
                            properties: ["id", "objectType"],
                            id: ids[0]
                        }, false, true).then(callback).catch(reject);
                    });
                }

                function getCurr() {
                    return new Promise(function (resolve, reject) {
                        crud.doSelect({
                            name: "Currency",
                            client: vClient
                        }, false, true).then(resolve).catch(reject);
                    });
                }

                function doPrint() {
                    return new Promise(function (resolve) {
                        let doc = "";
                        let n = 0;
                        let data;

                        form = form || buildForm(
                            localFeathers[rows[0].objectType],
                            localFeathers
                        );

                        function resolveProperty(key, fthr) {
                            let idx = key.indexOf(".");
                            let attr;
                            let rel;

                            if (idx !== -1) {
                                attr = key.slice(0, idx);
                                rel = fthr.properties[attr].type.relation;
                                fthr = localFeathers[rel];
                                key = key.slice(idx + 1, key.length);
                                return resolveProperty(key, fthr);
                            }

                            fthr.properties[key].name = key;
                            return fthr.properties[key];
                        }

                        function getLabel(feather, attr) {
                            feather = localFeathers[feather];
                            let p = resolveProperty(attr.attr, feather);
                            return (
                                attr.label ||
                                p.alias ||
                                p.name.toName()
                            );
                        }

                        function inheritedFrom(source, target) {
                            let feather = localFeathers[source];
                            let props;

                            if (!feather) {
                                return false;
                            }

                            props = feather.properties;

                            if (feather.name === target) {
                                return true;
                            }
                            return Object.keys(props).some(function (k) {
                                return props[k].inheritedFrom === target;
                            });
                        }

                        function formatMoney(value) {
                            let style;
                            let amount = value.amount || 0;
                            let curr = currs.find(
                                (c) => c.code === value.currency
                            );
                            let hasDisplayUnit = curr.hasDisplayUnit;
                            let minorUnit = (
                                hasDisplayUnit
                                ? curr.displayUnit.minorUnit
                                : curr.minorUnit
                            );

                            style = {
                                minimumFractionDigits: minorUnit,
                                maximumFractionDigits: minorUnit
                            };

                            if (hasDisplayUnit) {
                                curr.conversions.some(function (conv) {
                                    if (
                                        conv.toUnit().id === curr.displayUnit.id
                                    ) {
                                        amount = amount.div(
                                            conv.ratio
                                        ).round(minorUnit);

                                        return true;
                                    }
                                });

                                curr = currs.find(
                                    (c) => c.code === curr.displayUnit.code
                                );
                            }
                            return (
                                curr.symbol + " " +
                                amount.toLocaleString(undefined, style)
                            );
                        }

                        function formatValue(
                            row,
                            feather,
                            attr,
                            rec,
                            showLabel,
                            col
                        ) {
                            feather = localFeathers[feather];
                            let p = resolveProperty(attr, feather);
                            let curr;
                            let parts = attr.split(".");
                            let value = rec[parts[0]];
                            let item;
                            let nkey;
                            let lkey;
                            let cr = "\n";

                            parts.shift();
                            while (parts.length) {
                                if (value === null) {
                                    value = "";
                                    parts = [];
                                } else {
                                    value = value[parts.shift()];
                                }
                            }

                            if (typeof p.type === "object") {
                                if (value === null) {
                                    row[col] = "";
                                    return;
                                }

                                if (inheritedFrom(p.type.relation, "Address")) {
                                    value = rec[attr].street;
                                    if (rec[attr].unit) {
                                        value += cr + rec[attr].unit();
                                    }
                                    value += cr + rec[attr].city + ", ";
                                    value += rec[attr].state + " ";
                                    value += rec[attr].postalCode;
                                    value += cr + rec[attr].country;
                                    row[col] = value;
                                    return;
                                }

                                if (inheritedFrom(p.type.relation, "Contact")) {
                                    row[col] = value.fullName;
                                    if (showLabel) {
                                        if (value.phone) {
                                            row[col] += cr;
                                            row[col] += value.phone;
                                        }
                                        if (value.email) {
                                            row[col] += cr;
                                            row[col] += value.email;
                                        }
                                        if (value.address) {
                                            row[col] += cr;
                                            row[col] += (
                                                value.address.city + "," +
                                                value.address.state
                                            );
                                        }
                                    }
                                    return;
                                }

                                feather = localFeathers[p.type.relation];
                                nkey = Object.keys(feather.properties).find(
                                    (k) => feather.properties[k].isNaturalKey
                                );
                                if (showLabel) {
                                    lkey = Object.keys(feather.properties).find(
                                        (k) => feather.properties[k].isLabelKey
                                    );
                                }
                                if (lkey && !nkey) {
                                    nkey = lkey;
                                    lkey = undefined;
                                }
                                row[col] = value[nkey];

                                if (lkey) {
                                    row[col] += cr;
                                    row[col] += value[lkey];
                                }

                                return;
                            }

                            switch (p.type) {
                            case "string":
                                if (!value) {
                                    row[col] = "";
                                    return;
                                }
                                if (p.dataList) {
                                    item = p.dataList.find(
                                        (i) => i.value === value
                                    );
                                    value = item.label;
                                } else if (p.format === "date") {
                                    value = f.parseDate(
                                        value
                                    ).toLocaleDateString();
                                } else if (p.format === "dateTime") {
                                    value = new Date(value).toLocaleString();
                                }

                                row[col] = value;
                                break;
                            case "boolean":
                                if (value) {
                                    value = "True";
                                } else {
                                    value = "False";
                                }
                                row[col] = value;
                                break;
                            case "integer":
                            case "number":
                                row[col] = value.toLocaleString();
                                break;
                            case "object":
                                if (p.format === "money") {
                                    curr = currs.find(
                                        (c) => c.code === value.currency
                                    );
                                    if (curr) {
                                        value = formatMoney(value);
                                        row[col] = value;
                                    } else {
                                        row[col] = "Invalid currency";
                                    }
                                }
                                break;
                            default:
                                row[col] = value;
                            }
                        }
/*
                        function formatTable(obj) {
                            let feather = localFeathers[obj.feather];
                            let attr = obj.attribute;
                            let p = resolveProperty(attr.attr, feather);
                            let tr;
                            let maxWidth = doc.width.minus(
                                doc.paddingLeft
                            ).minus(doc.paddingRight);
                            let ttlWidth = 0;
                            let cols = attr.columns.filter(function (c) {
                                ttlWidth += c.width || COL_WIDTH_DEFAULT;
                                return ttlWidth <= maxWidth;
                            });
                            let table;

                            if (attr.showLabel) {
                                doc.cell("", {
                                    minHeight: 10
                                });
                                doc.cell(getLabel(obj.feather, attr) + ":", {
                                    padding: 5,
                                    font: fonts[defFont + "Bold"]
                                });
                            }

                            table = doc.table({
                                widths: cols.map(
                                    (c) => c.width || COL_WIDTH_DEFAULT
                                ),
                                borderHorizontalWidths: function (i) {
                                    return (
                                        i < 2
                                        ? 1
                                        : 0.1
                                    );
                                },
                                padding: 5
                            });
                            feather = localFeathers[p.type.relation];

                            tr = table.row({
                                font: fonts[defFont + "Bold"],
                                borderBottomWidth: 1.5
                            });

                            function addHeaderCol(col) {
                                let opts = {
                                    font: fonts[defFont + "Bold"]
                                };
                                let prop = resolveProperty(col.attr, feather);

                                if (
                                    prop.type === "number" ||
                                    prop.type === "integer" ||
                                    (
                                        prop.type === "object" &&
                                        prop.format === "money"
                                    )
                                ) {
                                    opts.textAlign = "right";
                                }
                                tr.cell(getLabel(feather.name, col), opts);
                            }

                            function addRow(rec) {
                                let row = table.row();

                                cols.forEach(function (col) {
                                    formatValue(
                                        row,
                                        rec.objectType,
                                        col.attr,
                                        rec,
                                        Boolean(form.showLabelKey),
                                        {
                                            font: col.font,
                                            fontSize: col.fontSize
                                        }
                                    );
                                });
                            }

                            cols.forEach(addHeaderCol);
                            data[attr.attr].forEach(addRow);
                        }
*/
                        function buildSection(tab) {
                            let attrs = form.attrs.filter((a) => a.grid === n);
                            let colCnt = 0;
                            let rowCnt = 0;
                            let ary = [];
                            let table;
                            let tableRows = [];
                            let units = [];
                            let c = 0;
                            let tables = [];

                            if (tab) {
                                // TODO: Build spacer?
                            }

                            // Figure out how many units (columns)
                            // in form
                            attrs.forEach(function (a) {
                                if (a.unit > colCnt) {
                                    colCnt = a.unit;
                                }
                                if (!ary[a.unit]) {
                                    ary[a.unit] = [a];
                                } else {
                                    ary[a.unit].push(a);
                                }
                            });
                            colCnt += 1;
                            ary.forEach(function (i) {
                                if (i.length > rowCnt) {
                                    rowCnt = i.length;
                                }
                            });

                            // Build table
                            while (c < colCnt) {
                                units.push(100); // label
                                units.push(134); // value
                                c += 1;
                            }

                            function addRow() {
                                let row = {};
                                let i = 0;
                                let attr;
                                let label;
                                let lblcol;
                                let valcol;

                                tableRows.push(row);

                                while (i < colCnt) {
                                    if (ary[i] === undefined) {
                                        i += 1;
                                        return;
                                    }
                                    lblcol = "label_" + i;
                                    valcol = "value_" + i;
                                    attr = ary[i].shift();
                                    if (attr) {
                                        // Handle Label
                                        if (
                                            attr.showLabel &&
                                            !attr.columns.length
                                        ) {
                                            label = getLabel(
                                                data.objectType,
                                                attr
                                            );

                                            row[lblcol] = label + ":";
                                        } else {
                                            row[lblcol] = "";
                                        }
                                        // Handle value
                                        if (attr.columns.length) {
                                            // Build tables after done with grid
                                            // Can't put a table in a cell
                                            tables.push({
                                                feather: data.objectType,
                                                attribute: attr
                                            });
                                        } else {
                                            formatValue(
                                                row,
                                                data.objectType,
                                                attr.attr,
                                                data,
                                                true,
                                                valcol
                                            );
                                        }
                                    }
                                    i += 1;
                                }
                            }
                            c = 0;
                            while (c < rowCnt) {
                                addRow();
                                c += 1;
                            }
                            table = new Table(tableRows);
                            doc += "\n";
                            doc += table.toString();
/*
                            while (tables.length) {
                                formatTable(tables.shift());
                            }
*/
                            n += 1;
                        }

                        doc = form.title || rows[0].objectType.toName();
                        doc += "\n";

                        // Loop through data to build content
                        while (rows.length) {
                            data = rows.shift();
                            buildSection();
                            form.tabs.forEach(buildSection);
                            n = 0;
                        }

                        resolve(doc);
                    });
                }

                requests.push(getData());
                requests.push(getCurr());
                if (form) {
                    requests.push(getForm());
                }
                Promise.all(requests).then(
                    getFeather
                ).then(
                    doPrint
                ).then(
                    resolve
                ).catch(reject);
            });
        };

        return that;
    };

}(exports));

