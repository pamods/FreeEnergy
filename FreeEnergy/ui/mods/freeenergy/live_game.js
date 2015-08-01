(function() {
	console.log("loaded free energy");
	
	var pmEconomyMap = function(handler, arguments) {
		if (api.panels.action_bar) {
			api.panels.action_bar.message(handler, arguments);
		} else {
			setTimeout(function() {
				pmEconomyMap(handler, arguments);
			}, 500);
		}
	};
	
	var armyIndex = undefined;
	var planets = undefined;
	
	var oldServerState = handlers.server_state;
	
	var shouldManage = ko.computed(function() {
		return model.armySize() > 0 && !model.isSpectator() && !model.showTimeControls();
	});
	
	shouldManage.subscribe(function(v) {
		pmEconomyMap("enableManagement", v);
	});
	
	handlers.server_state = function(msg) {
		oldServerState(msg);
		
		if (msg.data.armies && msg.data.client) {
			var idToIndexMap = {};
			var armies = msg.data.armies;
			for (var i = 0; i < armies.length; i++) {
				idToIndexMap[armies[i].id] = i;
			}
			armyIndex = idToIndexMap[msg.data.client.army_id];
			console.log("free energy: found my army index to be "+armyIndex);
		}
	};
	
	var oldCelestialData = handlers.celestial_data;
	handlers.celestial_data = function(payload) {
		oldCelestialData(payload);
		
		var result = [];
		var ps = payload.planets;
		for (var i = 0; i < ps.length; i++) {
			if (ps[i]) {
				result.push(ps[i].index);
			}
		}
		if (result.length > 0) {
			planets = result;
		}
		console.log(planets);
	};
	
	handlers.queryFreeEconomyInfo = function() {
		pmEconomyMap("setRelevantData", {
			armyIndex: armyIndex,
			planets: planets
		});
		pmEconomyMap("enableManagement", shouldManage());
	};
}());