/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/**
 * Remmina Search Provider for GNOME Shell
 *
 * Copyright (c) 2012 Alex Murray <murray.alex@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Params = imports.misc.params;
const Util = imports.misc.util;
const FileUtils = imports.misc.fileUtils;
const Lang = imports.lang;
const IconGrid = imports.ui.iconGrid;

const emblems = { 'NX': 'remmina-nx',
                  'RDP': 'remmina-rdp',
                  'SFTP': 'remmina-sftp',
                  'SSH': 'gnome-terminal',
                  'VNC': 'remmina-vnc',
                  'XDMCP': 'remmina-xdmcp' };
let provider = null;
const RemminaIconBin = new Lang.Class({
    Name: 'RemminaIconBin',

    _init: function(protocol, name) {
        this.actor = new St.Bin({ reactive: true,
                                  track_hover: true });
        this._protocol = protocol;
        this.icon = new IconGrid.BaseIcon(name,
                                          { showLabel: true,
                                            createIcon: Lang.bind(this, this.createIcon) } );

        this.actor.child = this.icon.actor;
        this.actor.label_actor = this.icon.label;
    },

    createIcon: function (size) {
        let box = new Clutter.Box();
        let icon = new St.Icon({ icon_name: 'remmina',
                                 icon_size: size });
        box.add_child(icon);
        if (this._protocol in emblems) {
            // remmina emblems are fixed size of 22 pixels
            let size = 22;
            let emblem = new St.Icon({ icon_name: emblems[this._protocol],
                                       icon_size: size});
            box.add_child(emblem);
        }
        return box;
    }
});

const RemminaSearchProvider = new Lang.Class({
    Name: 'RemminaSearchProvider',

    _init: function (name) {
        this.id = 'remmina';

        this._sessions = [];

        let path = GLib.build_filenamev([GLib.get_home_dir(), '/.remmina']);
        let dir = Gio.file_new_for_path(path);
        let monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        monitor.connect('changed', Lang.bind(this, this._onMonitorChanged));
        /* save a reference so we can cancel it on disable */
        this._remminaMonitor = monitor;

        FileUtils.listDirAsync(dir, Lang.bind(this, function (files) {
            files.map(function (f) {
                let name = f.get_name();
                let file_path = GLib.build_filenamev([path, name]);
                let file = Gio.file_new_for_path(file_path);
                this._onMonitorChanged(this._remminaMonitor, file,
                                       null, Gio.FileMonitorEvent.CREATED);
            }, this);
        }));
    },

    _onMonitorChanged: function(monitor, file, other_file, type) {
        let path = file.get_path();
        if (type == Gio.FileMonitorEvent.CREATED ||
            type == Gio.FileMonitorEvent.CHANGED ||
            type == Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
            let keyfile = new GLib.KeyFile();
            try {
                keyfile.load_from_file(path, 0);
            } catch (e) {
                return;
            }

            if (!keyfile.has_group('remmina')) {
                return;
            }
            let name = keyfile.get_string('remmina', 'name');
            if (name) {
                // get the type of session so we can use different
                // icons for each
                let protocol = keyfile.get_string('remmina', 'protocol');
                let session = { name: name,
                                protocol: protocol,
                                file: path };
                // if this session already exists in _sessions then
                // delete and add again to update it
                for (let i = 0; i < this._sessions.length; i++) {
                    let s = this._sessions[i];
                    if (s.file == session.file) {
                        this._sessions.splice(i, 1);
                        break;
                    }
                }
                this._sessions.push(session);
            }
        } else if (type == Gio.FileMonitorEvent.DELETED) {
            for (let i = 0; i < this._sessions.length; i++) {
                let s = this._sessions[i];
                if (s.file == path) {
                    /* remove the current element from _sessions */
                    this._sessions.splice(i, 1);
                    break;
                }
            }
        }
    },

    createResultObject: function (result, terms) {
        let icon = new RemminaIconBin(result.id.protocol, result.name);
        return icon;
    },


    filterResults: function (results, max) {
        return results.slice(0, max);
    },

    getResultMetas: function (ids, callback) {
        let metas = [];
        for (let i = 0; i < ids.length; i++) {
            let id = ids[i];
            metas.push({ id: id,
                         name: id.name + ' (' + id.protocol + ')' });
        }
        callback(metas);
    },

    activateResult: function (id) {
        Util.spawn([ 'remmina', '-c', id.file ]);
    },

    _getResultSet: function (sessions, terms) {
        let results = [];
        // search for terms ignoring case - create re's once only for
        // each term and make sure matches all terms
        let res = terms.map(function (term) { return new RegExp(term, 'i'); });
        for (let i = 0; i < sessions.length; i++) {
            let session = sessions[i];
            let failed = false;
            for (let j = 0; j < res.length; j++) {
                let re = res[j];
                // search on name, protocol or the term remmina
                failed |= (session.name.search(re) < 0 &&
                           session.protocol.search(re) < 0 &&
                           'remmina'.search(re) < 0);
                if (failed) {
                    break;
                }
            }
            if (!failed) {
                results.push(session);
            }
        }
        this.searchSystem.setResults(this, results);
    },

    getInitialResultSet: function (terms) {
        this._getResultSet(this._sessions, terms);
    },

    getSubsearchResultSet: function (results, terms) {
        this._getResultSet(results, terms);
    }
});

function init (meta) {
}

function enable () {
    if (!provider) {
        provider = new RemminaSearchProvider();
        Main.overview.addSearchProvider(provider);
    }
}

function disable() {
    if (provider) {
        Main.overview.removeSearchProvider(provider);
        provider._remminaMonitor.cancel();
        provider = null;
    }
}
