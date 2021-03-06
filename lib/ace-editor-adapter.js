/*
 *	Copyright 2014 Matthieu Nicolas
 *
 *	This file is part of Mute-client.
 *
 *  Mute-client is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  Mute-client is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with Mute-client.  If not, see <http://www.gnu.org/licenses/>.
 */

var events = require('events');
var UndoManager = ace.require('ace/undomanager').UndoManager;

var INIT_MODE = -1;
var EDITOR_MODE = 0;
var HISTORY_MODE = 1;

var AceEditorAdapter = function (itemID, coordinator) {
	var aceEditorAdapter = this;
	var style = document.createElement('style');
	
	this.coordinator = coordinator;
	this.previousUndoManager = null;
	this.currentMarkers = [];
	this.userInfosChanged = false;
	this.mousePos = null;
	this.mode = INIT_MODE;
	this.flag = false;
	this.lastCursorIndex = 0;
	this.previousLine = 0;
	this.userInfosUpdateTimeout = null;
	this.disabled = false;

	Range = ace.require('ace/range').Range;

	style.type = 'text/css';
	style.innerHTML = '.editor { margin-left: 15px; margin-top: 15px; width: 1100px; height: 600px; overflow: visible }';
	document.getElementsByTagName('head')[0].appendChild(style);

	document.getElementById(itemID).className = 'editor';

	this.editor = ace.edit(itemID);

	this.editor.setTheme('ace/theme/dawn');
	this.editor.getSession().setTabSize(4);
	this.editor.getSession().setUseWrapMode(true);

	if(this.coordinator !== null) {
		this.coordinator.on('initEditor', function (data) {
			if(aceEditorAdapter.disabled === false) { 
				aceEditorAdapter.init(data);
			}
		});

		this.coordinator.on('coordinatorDisposed', function (data) {
			if(aceEditorAdapter.disabled === false) {
				aceEditorAdapter.onCoordinatorDisposedHandler(data);
			}
		});
	}

	this.editor.session.on('changeScrollTop', function (e) {
		if(aceEditorAdapter.disabled === false) { 
			aceEditorAdapter.emit('scroll', { topRow: aceEditorAdapter.editor.renderer.getScrollTopRow() });
    	}
    });

    this.editor.focus();
};

AceEditorAdapter.prototype.__proto__ = events.EventEmitter.prototype;

AceEditorAdapter.prototype.setInfosUsersModule = function (infosUsersModule) {
	var editor = this;

	this.infosUsersModule = infosUsersModule;
}

AceEditorAdapter.prototype.init = function (data) {
	// If we reconnect while being in history mode
	if(this.mode !== HISTORY_MODE) {
		this.toHistoryMode();
		this.editor.setValue(data.str);	
		this.updateInfosUser();
		this.toEditionMode(true);
		this.infosUsersModule.updateRemoteInfosUsers();
	}
};

AceEditorAdapter.prototype.sendUserInfos = function () {
	var doc = this.editor.session.doc;
	var index;
	var aceSelections;
	var i;
	var selections = [];
	var indexStart;
	var indexEnd;

	index = doc.positionToIndex(this.editor.getCursorPosition());
	aceSelections = this.editor.session.getSelection();
	if(aceSelections !== null && aceSelections !== undefined && !aceSelections.isEmpty()) {
		if(!aceSelections.inMultiSelectMode) {
			if(aceSelections.isBackwards()) {
				indexStart = doc.positionToIndex(aceSelections.lead);
				indexEnd = doc.positionToIndex(aceSelections.anchor);
			}
			else {
				indexStart = doc.positionToIndex(aceSelections.anchor);
				indexEnd = doc.positionToIndex(aceSelections.lead);
			}
			selections.push({ start: indexStart, end: indexEnd });
		}
	}
	this.emit('changeCursorAndSelections', { infosUser: { cursorIndex: index, selections: selections } });
};

AceEditorAdapter.prototype.onChangeAdapter = function (e) {
	var data = e.data;
    var i;
    var action;
    var index = this.editor.session.doc.positionToIndex(data.range.start, 0);
    var text = '';

    this.userInfosChanged = true;

    if(data.action === 'insertLines' || data.action === 'removeLines') {
		action = data.action.replace('Lines', 'Text');
		for(i=0; i<data.lines.length; i++) {
			text += data.lines[i] + '\n';
		}
    }
    else {
    	action = data.action;
    	text = data.text; 
    }
    this.emit('localOperation', { operation: { action: action, index: index, text: text }});
    this.infosUsersModule.updateRemoteInfosUsers();
};

AceEditorAdapter.prototype.update = function (data) {
	/**
	 * 	Format attendu de data : 
	 *	data = {
	 *		str: La nouvelle chaîne de caractères qui correspond au modèle
	 * 		//diffCursor: Le nombre de caractères dont le curseur doit se déplacer pour répercuter la modification du modèle
	 *		operations: Tableau contenant l'ensemble des textOperations obtenues à partir de la LogootSOp distante
	 *		diffNbLines: Le nombre de lignes dont la vue doit scroller pour répercuter la modification du modèle
	 * 	}
	 */

	var aceEditorAdapter = this;

	var doc = this.editor.session.doc;
	var i, j;
	var operation;

	this.editor.removeAllListeners('change');

	for(i=0; i<data.operations.length; i++) {
		operation = data.operations[i];
		console.log('text: ', this.editor.getValue());
		console.log('operation: ', operation);
		if(operation.content !== undefined) {
			var position = doc.indexToPosition(operation.offset);
			doc.insert(position, operation.content);
		}
		else {
			var start = doc.indexToPosition(operation.offset);
			var end = doc.indexToPosition(operation.offset + operation.length);
			doc.remove(new Range(start.row, start.column, end.row, end.column));
		}
	}

	// Update the collaborators' infos
	this.infosUsersModule.updateRemoteInfosUsers();

	this.editor.on('change', function (e) {
		if(aceEditorAdapter.disabled === false) { 
			aceEditorAdapter.onChangeAdapter(e);
		}
	});
};

AceEditorAdapter.prototype.clearRemoteIndicators = function () {
	var i;
	if(this.currentMarkers !== null && this.currentMarkers !== length) {
		for(i=0; i<this.currentMarkers.length; i++) {
			this.editor.session.removeMarker(this.currentMarkers[i]);
		}
	}
};

AceEditorAdapter.prototype.addRemoteCursor = function (cursorIndex, cursorHTML) {
	var posCursor = this.editor.session.doc.indexToPosition(cursorIndex);
	var range = new Range(posCursor.row, posCursor.column, posCursor.row, posCursor.column+1);

	this.currentMarkers.push(this.editor.session.addMarker(range, '', function (html, range, left, top, config) {
		var finalCursorHTML = cursorHTML.replace('top:FLAG_TOP', 'top:'+top).replace('left:FLAG_LEFT', 'left:'+left);
		return html.push(finalCursorHTML);
	}, true));
};

AceEditorAdapter.prototype.addRemoteSelection = function (selections, cssClass) {
	var posStart;
	var posEnd;
	var range;
	var i;

	for(i=0; i<selections.length; i++) {
		posStart = this.editor.session.doc.indexToPosition(selections[i].start);
		posEnd = this.editor.session.doc.indexToPosition(selections[i].end);
		range = new Range(posStart.row, posStart.column, posEnd.row, posEnd.column);
		this.currentMarkers.push(this.editor.session.addMarker(range, cssClass, 'line'));
	}
};

AceEditorAdapter.prototype.updateVisibleNames = function () {
	var i;
	var row;
	var column;
	
	var remoteCursors = $('[data-remote-cursor=true]');
	var remoteCursorID;

	for(i=0; i<remoteCursors.length; i++) {
		remoteCursorID = '#' + remoteCursors[i].id;
		row = $(remoteCursorID).attr('data-remote-cursor-row');
		column = $(remoteCursorID).attr('data-remote-cursor-column');

		$(remoteCursorID).find('.name').hide();
		$(remoteCursorID).find('.nubbin').show();

		if(this.mousePos.row == row && this.mousePos.column == column) {
			$(remoteCursorID).find('.name').show();
			$(remoteCursorID).find('.nubbin').hide();	
		}
	}
};

AceEditorAdapter.prototype.toHistoryMode = function () {
	if(this.mode !== HISTORY_MODE) {
		this.previousUndoManager = this.editor.session.getUndoManager();
		this.editor.session.setUndoManager(new UndoManager());
		this.previousLine = parseInt(this.editor.renderer.getScrollTopRow());
		this.editor.removeAllListeners('change');
		this.editor.removeAllListeners('changeSelection');
		this.editor.removeAllListeners('mousemove');
		this.coordinator.removeAllListeners('update');
		this.editor.setReadOnly(true);
		this.emit('readOnlyModeOn');
		this.mode = HISTORY_MODE;
	}
};

AceEditorAdapter.prototype.setText = function (text) {
	this.editor.session.doc.setValue(text);
};

AceEditorAdapter.prototype.toEditionMode = function (flag) {
	var aceEditorAdapter = this;
	var pos;

	if(this.mode !== EDITOR_MODE) {
		this.editor.on('change', function (e) {
			if(aceEditorAdapter.disabled === false) { 
				aceEditorAdapter.onChangeAdapter(e);
			}
		});

		if(this.coordinator !== null && this.coordinator !== undefined) {
			this.coordinator.on('update', function (data) {
				if(aceEditorAdapter.disabled === false) { 
					aceEditorAdapter.update(data);
				}
			});	
		}

		this.editor.on('changeSelection', function (e) {
			if(aceEditorAdapter.disabled === false) { 
				aceEditorAdapter.lastCursorIndex = aceEditorAdapter.editor.session.doc.positionToIndex(aceEditorAdapter.editor.getCursorPosition());
				if(aceEditorAdapter.userInfosUpdateTimeout === null) {
					aceEditorAdapter.userInfosUpdateTimeout = setTimeout(function () {
						aceEditorAdapter.sendUserInfos();
						aceEditorAdapter.userInfosUpdateTimeout = null;
					}, 1000);
				};
				aceEditorAdapter.userInfosChanged = true;
			}
		});

		this.editor.on('mousemove', function (e) {
			if(aceEditorAdapter.disabled === false) { 
				aceEditorAdapter.mousePos = aceEditorAdapter.editor.renderer.screenToTextCoordinates(e.clientX, e.clientY);
				aceEditorAdapter.updateVisibleNames();
			}
		});

		pos = this.editor.session.doc.indexToPosition(this.lastCursorIndex, 0)
		this.editor.navigateTo(pos.row, pos.column);
		this.editor.scrollToRow(this.previousLine);

		this.editor.session.setUndoManager(this.previousUndoManager);
		this.previousUndoManager = null;
		this.editor.setReadOnly(false);
		this.emit('readOnlyModeOff');
		this.mode = EDITOR_MODE;

		this.editor.focus();
	}
};

AceEditorAdapter.prototype.isInHistoryMode = function () {
	return this.mode === HISTORY_MODE;
};

AceEditorAdapter.prototype.isInEditorMode = function () {
	return this.mode === EDITOR_MODE;
};

AceEditorAdapter.prototype.indexToPosition = function (index) {
	return this.editor.session.doc.indexToPosition(index, 0);
};

AceEditorAdapter.prototype.updateInfosUser = function () {
	var doc = this.editor.session.doc;
	var infosUser = this.infosUsersModule.getLocalInfosUser();
	var selection = this.editor.getSelection();
	var posStartSelection;
	var posEndSelection;
	var pos;

	// Update the user's cursor's index and the current text selected
	pos = doc.indexToPosition(infosUser.cursorIndex, 0);
	this.editor.navigateTo(pos.row, pos.column);

	selection.ranges = [];
	selection.rangeCount = 0;
	for(i=0; i<infosUser.selections.length; i++) {
		posStartSelection = doc.indexToPosition(infosUser.selections[i].start);
		posEndSelection = doc.indexToPosition(infosUser.selections[i].end);

		selection.setSelectionRange(new Range(posStartSelection.row, posStartSelection.column, posEndSelection.row, posEndSelection.column));
	}
};

AceEditorAdapter.prototype.onCoordinatorDisposedHandler = function (data) {
	var key;

	this.emit('textEditorAdapterDisposed');
	this.editor.setReadOnly(true);

    for(key in this) {
        if(this.hasOwnProperty(key) === true) {
            if(key === 'disabled') {
            	this.disabled = true;
            }
            else if(key !== 'editor') {
                this[key] = null;
            }
        }
    }

    this.setText(data.str);
    this.clearRemoteIndicators();
};

module.exports = AceEditorAdapter;