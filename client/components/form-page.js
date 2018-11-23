/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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
/*jslint this, es6*/
/*global window, require, module*/
(function () {
    "use strict";

    const formPage = {};
    const m = require("mithril");
    const f = require("common-core");
    const stream = require("stream");
    const button = require("button");
    const catalog = require("catalog");
    const formWidget = require("form-widget");

    formPage.viewModel = function (options) {
        var toggleNew, isDisabled, applyTitle, saveTitle,
                saveAndNewTitle, callReceiver, model, createForm,
                instances = catalog.register("instances"),
                feather = options.feather.toCamelCase(true),
                forms = catalog.store().forms(),
                formId = options.form || Object.keys(forms).find(function (id) {
            return forms[id].feather === feather;
        }),
                form = forms[formId],
                vm = {},
                pageIdx = options.index || 1,
                isNew = options.create && options.isNew !== false;

        // Check if we've already got a model instantiated
        if (options.key && instances[options.key]) {
            model = instances[options.key];
        } else {
            model = options.feather.toCamelCase();
        }

        vm.buttonApply = stream();
        vm.buttonBack = stream();
        vm.buttonSave = stream();
        vm.buttonSaveAndNew = stream();
        vm.doApply = function () {
            vm.model().save().then(function () {
                callReceiver(false);
            });
        };
        vm.doBack = function () {
            var instance = vm.model();

            if (instance.state().current()[0] === "/Ready/Fetched/Dirty") {
                instance.state().send("undo");
            }

            // Once we consciously leave, purge memoize
            delete instances[vm.model().id()];
            window.history.go(pageIdx * -1);
        };
        vm.doNew = function () {
            var opts = {
                    feather: options.feather,
                    key: f.createId()
                },
                state = {
                    state: {
                        form: options.form,
                        index: pageIdx + 1,
                        create: true,
                        receiver: options.receiver
                    }
                };
            m.route.set("/edit/:feather/:key", opts, state);
        };
        vm.doSave = function () {
            vm.model().save().then(function () {
                callReceiver();
                vm.doBack();
            });
        };
        vm.doSaveAndNew = function () {
            vm.model().save().then(function () {
                callReceiver();
                delete instances[vm.model().id()];
                vm.doNew();
            });
        };
        vm.formWidget = stream();
        vm.model = function () {
            return vm.formWidget().model();
        };
        vm.title = function () {
            return options.feather.toName();
        };

        // ..........................................................
        // PRIVATE
        //

        toggleNew = function (isNew) {
            vm.buttonSaveAndNew().title("");
            if (isNew || !vm.model().canSave()) {
                vm.buttonSaveAndNew().label("&New");
                vm.buttonSaveAndNew().onclick(vm.doNew);
            } else {
                vm.buttonSaveAndNew().label("Save and &New");
                vm.buttonSaveAndNew().onclick(vm.doSaveAndNew);
            }
        };

        createForm = function (opts) {
            var state,
                w = formWidget.viewModel(opts);

            vm.formWidget(w);
            state = w.model().state();
            state.resolve("/Ready/New").enter(toggleNew.bind(this, false));
            state.resolve("/Ready/Fetched/Clean").enter(toggleNew.bind(this, true));
            state.resolve("/Ready/Fetched/Dirty").enter(toggleNew.bind(this, false));
        };

        // Helper function to pass back data to sending model
        callReceiver = function () {
            var receivers;
            if (options.receiver) {
                receivers = catalog.register("receivers");
                if (receivers[options.receiver]) {
                    receivers[options.receiver].callback(vm.model());
                }
            }
        };

        // Create form widget
        createForm({
            isNew: isNew,
            model: model,
            id: options.key,
            config: form,
            outsideElementIds: ["toolbar"]
        });

        // Once model instantiated let history know already created so we know
        // to fetch if navigating back here through history
        if (isNew) {
            options.isNew = false;
            m.route.set(m.route.get(), null, {
                replace: true,
                state: options
            });
        }

        // Memoize our model instance in case we leave and come back while zooming
        // deeper into detail
        instances[vm.model().id()] = vm.model();

        // Create button view models
        vm.buttonBack(button.viewModel({
            onclick: vm.doBack,
            label: "&Back",
            icon: "arrow-left",
            class: "suite-toolbar-button"
        }));

        vm.buttonApply(button.viewModel({
            onclick: vm.doApply,
            label: "&Apply",
            class: "suite-toolbar-button"
        }));

        vm.buttonSave(button.viewModel({
            onclick: vm.doSave,
            label: "&Save",
            icon: "cloud-upload",
            class: "suite-toolbar-button"
        }));

        vm.buttonSaveAndNew(button.viewModel({
            onclick: vm.doSaveAndNew,
            label: "Save and &New",
            icon: "plus-circle",
            class: "suite-toolbar-button"
        }));
        if (catalog.getFeather(feather).isReadOnly) {
            vm.buttonSaveAndNew().label("&New");
            vm.buttonSaveAndNew().title("Table is read only");
            vm.buttonSaveAndNew().disable();
        }

        // Bind model state to display state
        isDisabled = function () {
            return !vm.model().canSave();
        };
        applyTitle = vm.buttonApply().title;
        saveTitle = vm.buttonSave().title;
        saveAndNewTitle = vm.buttonSaveAndNew().title;
        vm.buttonApply().isDisabled = isDisabled;
        vm.buttonApply().title = function () {
            if (isDisabled()) {
                return vm.model().lastError() || "No changes to apply";
            }
            return applyTitle();
        };
        vm.buttonSave().isDisabled = isDisabled;
        vm.buttonSave().title = function () {
            if (isDisabled()) {
                return vm.model().lastError() || "No changes to save";
            }
            return saveTitle();
        };
        vm.buttonSaveAndNew().isDisabled = isDisabled;
        vm.buttonSaveAndNew().title = function () {
            if (isDisabled()) {
                return vm.model().lastError() || "No changes to save";
            }
            return saveAndNewTitle();
        };

        return vm;
    };

    formPage.component = {
        oninit: function (vnode) {
            this.viewModel = vnode.attrs.viewModel || formPage.viewModel(vnode.attrs);
        },

        view: function () {
            var lock, title,
                    vm = this.viewModel,
                    model = vm.model(),
                    icon = "file-text";

            switch (model.state().current()[0]) {
            case "/Locked":
                icon = "lock";
                lock = model.data.lock() || {};
                title = "User: " + lock.username + "\x0ASince: " +
                        new Date(lock.created).toLocaleTimeString();
                break;
            case "/Ready/Fetched/Dirty":
                icon = "pencil";
                title = "Editing record";
                break;
            case "/Ready/New":
                icon = "plus";
                title = "New record";
                break;
            }

            // Build view
            return m("div", [
                m("div", {
                    id: "toolbar",
                    class: "suite-toolbar"
                }, [
                    m(button.component, {
                        viewModel: vm.buttonBack()
                    }),
                    m(button.component, {
                        viewModel: vm.buttonApply()
                    }),
                    m(button.component, {
                        viewModel: vm.buttonSave()
                    }),
                    m(button.component, {
                        viewModel: vm.buttonSaveAndNew()
                    })
                ]),
                m("div", {
                    class: "suite-title"
                }, [
                    m("i", {
                        class: "fa fa-" + icon + " suite-title-icon",
                        title: title
                    }),
                    m("label", vm.title())
                ]),
                m(formWidget.component, {
                    viewModel: vm.formWidget()
                })
            ]);
        }
    };

    catalog.register("components", "formPage", formPage.component);
    module.exports = formPage;

}());