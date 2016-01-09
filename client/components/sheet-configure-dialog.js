/**
    Framework for building object relational database apps

    Copyright (C) 2016  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

(function () {
  "use strict";

  var sheetConfigureDialog = {},
    m = require("mithril"),
    f = require("component-core"),
    catalog = require("catalog"),
    tableDialog = require("table-dialog"),
    statechart = require("statechartjs");

  /**
    View model for sort dialog.

    @param {Object} Options
    @param {Function} [options.config] Filter property being modified
    @param {Function} [options.filter] Filter property
  */
  sheetConfigureDialog.viewModel = function (options) {
    options = options || {};
    var vm, state, currentState, tableView,
      cache = f.copy(options.parentViewModel.sheet()),
      leftTabClass = ["pure-button", "suite-sheet-group-tab", "suite-sheet-group-tab-left"],
      rightTabClass = ["pure-button", "suite-sheet-group-tab", "suite-sheet-group-tab-right"];

    options.onOk = function () {
      var route,
        id = vm.sheetId(),
        sheet = vm.model().toJSON(),
        workbook = vm.workbook();

      vm.sheet(id, sheet);
      workbook.data.localConfig(vm.config());
      f.buildRoutes(workbook.toJSON());
      route = "/" + workbook.data.name() + "/" + sheet.name;
      route = route.toSpinalCase();
      m.route(route);
      vm.state().send("close");
    };
    options.icon = "gear";
    options.title = "Configure worksheet";

    // ..........................................................
    // PUBLIC
    //

    vm = tableDialog.viewModel(options);
    tableView = vm.content;
    vm.addAttr = function (attr) {
      if (!this.some(vm.hasAttr.bind(attr))) {
        this.push({attr: attr});
        return true;
      }
    };
    vm.attrs = function () {
      var model = vm.model(),
        feather = catalog.getFeather(model.data.feather()),
        keys = feather ? Object.keys(feather.properties) : false;
      return  keys ? f.resolveProperties(feather, keys).sort() : [];
    };
    vm.config = options.parentViewModel.config;
    vm.content = function () {
      var feathers,
        d = vm.model().data,
        nameId = f.createId(),
        featherId = f.createId(),
        formNameId = f.createId();

      feathers = vm.feathers().map(function (feather) {
        return m("option", feather);
      });

      return m("div", {
        class: "pure-form pure-form-aligned suite-sheet-configure-content"
      }, [
        m("div", {class: "pure-control-group"}, [
          m("label", {
            for: nameId
          }, "Name:"),
          m("input", {
            value: d.name(),
            required: true,
            oninput: m.withAttr("value", d.name)
          })
        ]),
        m("div", {class: "pure-control-group"}, [
          m("label", {
            for: featherId
          }, "Table:"),
          m("select", {
            value: d.feather(),
            required: true,
            oninput: m.withAttr("value", d.feather)
          }, feathers)
        ]),
        m("div", {class: "pure-control-group"}, [
          m("label", {
            for: formNameId
          }, "Form:"),
          m("input", {
            value: d.form().data.name(),
            required: true,
            oninput: m.withAttr("value", d.form().data.name)
          })
        ]),
        m("div", {class: "suite-sheet-configure-tabs"} , [
          m("button", {
            class: leftTabClass.join(" "),
            onclick: state.send.bind(state, "list")
          }, "List"),
          m("button", {
            class: rightTabClass.join(" "),
            onclick: state.send.bind(state, "form")
          }, "Form")
        ]),
        m("div", {class: "suite-sheet-configure-group-box"}, [
          tableView()
        ])
      ]);
    };
    vm.data = function () { 
      return currentState().data(); 
    };
    vm.hasAttr = function (item) { 
      return item.attr === this;
    };
    vm.feathers = function () {
      var feathers = catalog.data(),
        result = Object.keys(feathers).filter(function (name) {
          return !feathers[name].isChild && !feathers[name].isSystem;
        }).sort();
      return result;
    };
    vm.model = f.prop(catalog.store().models().workbookLocalConfig(cache));
    vm.okDisabled = function () {
      return !vm.model().isValid();
    };
    vm.okTitle = function () {
      return vm.model().lastError();
    };
    vm.sheetId = m.prop(options.sheetId);
    vm.reset = function () {
      var id = vm.sheetId();
      cache = f.copy(vm.sheet(id));
      vm.model(catalog.store().models().workbookLocalConfig(cache));
      if (!cache.list.columns.length) { vm.add(); }
      vm.selection(0);
    };
    vm.sheet = options.parentViewModel.sheet;
    vm.workbook = options.parentViewModel.workbook;
    vm.viewHeaderIds = m.prop({
      column: f.createId(),
      label: f.createId()
    });
    vm.viewHeaders = function () {
      var ids = vm.viewHeaderIds();
      return [
        m("th", {style: {minWidth: "165px"}, id: ids.column }, currentState().attrName()),
        m("th", {style: {minWidth: "220px"}, id: ids.label }, "Label")
      ];
    };
    vm.viewRows = function () {
      var view;

      view = vm.items().map(function (item) {
        var row;

        row = m("tr", {
          onclick: vm.selection.bind(this, item.index, true),
          style: {backgroundColor: vm.rowColor(item.index)}
        },[
          m("td", {style: {minWidth: "165px", maxWidth: "165px"}}, m("select", {
              value: item.attr,
              onchange: m.withAttr(
                "value",
                vm.itemChanged.bind(this, item.index, "attr"))
            }, vm.attrs().map(function (attr) {
                return m("option", {value: attr}, attr.toName());
              })
            )
          ),
          m("td", {style: {minWidth: "220px", maxWidth: "220px"}}, m("input", {
              value: item.label || item.attr.toName(),
              onchange: m.withAttr(
                "value",
                vm.itemChanged.bind(this, item.index, "label"))
            })
          )
        ]);

        return row;
      });

      return view;
    };

    // ..........................................................
    // PRIVATE
    //

    vm.style().width = "510px";

    currentState = function () {
      return state.resolve(state.current()[0]);
    };

    // Statechart
    state = statechart.define(function () {
      var primaryOn, primaryOff;

      primaryOn = function () {
        this.push("suite-sheet-group-tab-active");
      };

      primaryOff = function () {
        this.pop();
      };

      this.state("Group", function () {
        this.state("List", function () {
          this.event("form", function () {
            this.goto("../Form");
          });
          this.enter(primaryOn.bind(leftTabClass));
          this.exit(primaryOff.bind(leftTabClass));
          this.attrName = m.prop("Column");
          this.data = function () {
            return vm.model().data.list().data.columns();
          };
        });
        this.state("Form", function () {
          this.event("list", function () {
            this.goto("../List");
          });
          this.enter(primaryOn.bind(rightTabClass));
          this.exit(primaryOff.bind(rightTabClass));
          this.attrName = m.prop("Attribute");
          this.data = function () {
            return vm.model().data.form().data.attrs();
          };
        });
      });
    });
    state.goto();
  
    // Always clear undo function when done
    vm.state().resolve("/Display/Showing").enter(vm.reset);
    vm.state().resolve("/Display/Closed").enter(function () {
      vm.onCancel = m.prop();
    });

    vm.reset();

    return vm;
  };

  /**
    Filter dialog component

    @params {Object} View model
  */
  sheetConfigureDialog.component = tableDialog.component;

  module.exports = sheetConfigureDialog;

}());
