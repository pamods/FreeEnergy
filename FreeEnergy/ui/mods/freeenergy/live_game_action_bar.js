(function() {
	console.log("loaded free energy");

	// ---------- configuration constants
	
	var workInterval = 499;
	var prioLevel = 1.05;
	var noPrioLevel = 2.55;
	var storageFractionRich = 0.6;
	
	//--------------------- First modify the UI ----------------------//
	
	model.userPriorities = {};
	model.userPauses = {};
	
	var baseEngine = engine.call;
	var hookEngineCall = function(callName, handler) {
		var oldEngineCall = engine.call;
		engine.call = function() {
			if (arguments && arguments[0] === callName) {
				return handler.apply(this, arguments);
			} else {
				return oldEngineCall.apply(this, arguments);
			}
		};
	};
	
	hookEngineCall("set_order_state", function(call, action, value) {
		if (action === "energy") {
			// ignore, handled elsewhere
		} else {
			return baseEngine.apply(this, arguments);
		}
	});
	
	model.energyOrdersMap = {}; // this breaks the default computed to never do anything
	
	var getEnergyState = function(id) {
		if (model.userPauses[id]) {
			return 'conserve';
		} else if (model.userPriorities[id]) {
			return 'priority';
		} else {
			return 'consume';
		}
	};
	
	var allowEnergyOrders = function(spec) {
		var unit = model.parsedUnitSpecs()[spec];
		if (!unit) {
			return false;
		} else {
			return unit.canBuild || unit.consumption.energy > 0 ||
				(unit.allowedCommands && (unit.allowedCommands.Reclaim || unit.allowedCommands.Repair));
		}
	};
	
	model.getEnergyConsumers = ko.computed(function() {
		var selection = model.selection();
		if (selection) {
			var result = [];
			_.forEach(selection.spec_ids, function(elem, key) {
				if (allowEnergyOrders(key) && elem.length > 0) {
					for (var i = 0; i < elem.length; i++) {
						result.push(elem[i]);
					}
				}
			});
			return result;
		} else {
			return [];
		}
	});
	
	var recalcActiveEnergyOrder = ko.observable(0);
	
	model.activeEnergyOrder = ko.computed(function() {
		recalcActiveEnergyOrder();
		var units = model.getEnergyConsumers();
		if (units.length > 0) {
			var state = getEnergyState(units[0]);
			for (var i = 1; i < units.length; i++) {
				if (state !== getEnergyState(units[i])) {
					return "inconsistent";
				}
			}
			return state;
		} else {
			return "inconsistent";
		}
	});
	
	model.selectedEnergyOrderImage = ko.computed(function() {
		return "coui://ui/mods/freeenergy/icons_orders_energy_" + model.activeEnergyOrder() + ".png";
	});
	
	var energyOrders = ['consume', 'conserve', 'priority', 'inconsistent'];
	model.toggleEnergyOrderIndex = function() {
		var index = energyOrders.indexOf(model.activeEnergyOrder());
		index++;
		index = index % energyOrders.length;
		if (energyOrders[index] === "inconsistent") {
			index++;
			index = index % energyOrders.length;
		}
		selectEnergyState(energyOrders[index]);
	};
	
	var selectEnergyState = function(state) {
		var units = model.getEnergyConsumers();
		_.forEach(units, function(id) {
			model.userPriorities[id] = state === "priority";
			model.userPauses[id] = state === "conserve";
		});
		recalcActiveEnergyOrder(Date.now());
	};
	
	model.selectionConsume = function() {
		selectEnergyState("consume");
	};
	
	model.selectionConserve = function() {
		selectEnergyState("conserve");
	};
	
	model.selectionPriority = function() {
		selectEnergyState("priority");
	};
	
	$('.order_energy_menu .div_order_menu_cont').append('<div class="div_order_menu_item btn_std_ix" data-bind="click: selectionPriority, click_sound: \'default\', rollover_sound: \'default\'"> <img class="icon_command icon_order" src="coui://ui/mods/freeenergy/icons_orders_energy_priority.png" />');


	//------------------------ UI modifications finished. Starting with economy management code --------------------//
	
	model.currentEnergy = ko.observable(0);
	model.maxEnergy = ko.observable(0);
	model.energyGain = ko.observable(0);
	model.energyLoss = ko.observable(0);
	model.currentMetal = ko.observable(0);
	model.maxMetal = ko.observable(0);
	model.metalGain = ko.observable(0);
	model.metalLoss = ko.observable(0);
	model.hasFirstResourceUpdate = ko.observable(false);
	model.metalFraction = ko.computed(function() {
		return (model.maxMetal()) ? model.currentMetal() / model.maxMetal() : 0.0;
	});
	model.energyFraction = ko.computed(function() {
		return (model.maxEnergy()) ? model.currentEnergy() / model.maxEnergy() : 0.0;
	});
	
	model.playerIsRich = ko.computed(function() {
		return (model.metalFraction() > storageFractionRich && model.energyFraction() > storageFractionRich);
	});
	
	var oldHandlerArmy = handlers.army;
	handlers.army = function(payload) {
		model.currentEnergy(payload.energy.current);
		model.maxEnergy(payload.energy.storage);
		model.energyGain(payload.energy.production);
		model.energyLoss(payload.energy.demand);
		model.currentMetal(payload.metal.current);
		model.maxMetal(payload.metal.storage);
		model.metalGain(payload.metal.production);
		model.metalLoss(payload.metal.demand);
		model.hasFirstResourceUpdate(true);
		if (oldHandlerArmy) {
			oldHandlerArmy(payload);
		}
	};
	
	model.metalNet = ko.computed(function() {
		return model.metalGain() - model.metalLoss();
	});
	
	model.energyNet = ko.computed(function() {
		return model.energyGain() - model.energyLoss();
	});
	
	model.autoKillSwitch = ko.observable(false);
	model.gameActive = ko.observable(false);

	model.enableAutomatic = ko.computed(function() {
		return model.gameActive() && !model.autoKillSwitch();
	});
	
	var armyIndex = undefined;
	var planets = undefined;
	
	var world = api.getWorldView(0);
	
	world.setServerCulling(false);
	
	function contains(ar, val) {
		return ar !== undefined && $.inArray(val, ar) !== -1;
	}
	
	var isType = function(spec, type) {
		return contains(unitSpecMapping[spec], type);
	};
	
	var specEconomyMapping = undefined;
	var managedSpecs = {};
	var unitSpecMapping = undefined;
	unitInfoParser2.loadUnitEconomyDataMapping(function(mapping) {
		specEconomyMapping = mapping;
		
		console.log("economy spec map");
		console.log(specEconomyMapping);
		
		unitInfoParser2.loadUnitTypeMapping(function(mapping) {
			unitSpecMapping = mapping;
			
			_.forEach(specEconomyMapping, function(conf, spec) {
				if (conf.energyUse || conf.metalUse) {
					managedSpecs[spec] = true;
				}
			});
			console.log("managed specs map");
			console.log(managedSpecs);
		});
	});
		
	model.autoPauses = {};
	model.activeAutoPauses = {};
	
	model.pauseTimes = {};
	
	model.getPauseState = function(id) {
		var pauseTime = model.pauseTimes[id];
		var needsUnpause = pauseTime !== undefined && Date.now() - pauseTime > 10000;
		var shouldPause = !needsUnpause && !model.playerIsRich() && (model.userPauses[id] || model.autoPauses[id]);
		if (!shouldPause || pauseTime === undefined) {
			model.pauseTimes[id] = Date.now();
		}
		return shouldPause; 
	};
	
	var checkData = function() {
		if (armyIndex !== undefined && planets !== undefined) {
			return true;
		} else {
			console.log("free energy: still waiting for full data....");
			console.log(armyIndex);
			console.log(planets);
			api.Panel.message(api.Panel.parentId, 'queryFreeEconomyInfo');
			return false;
		}
	};
	
	model.checkData = checkData;
	
	var wallIds = {};
	
	model.withAllUnitBySpec = function(task) {
		if (checkData()) {
			for (var i = 0; i < planets.length; i++) {
				world.getArmyUnits(armyIndex, i).then(function(data) {
					try {
						var walls = data["/pa/units/land/land_barrier/land_barrier.json"];
						if (walls) {
							_.forEach(walls, function(wid) {
								wallIds[wid] = true;
							});
						}
						_.forEach(data, function(elem, key) {
							task(key, elem);
						});
					} catch (e) {
						console.log(e.stack);
					}
				});
			}
		}
	};
	
	var setPauseViaIDs = function(ids, paused) {
		if (ids.length === 0) {
			return;
		}
		var order = {
			units: ids,
			command: 'energy_stance',
			stance: paused ? "conserve" : "consume"
		};
		world.sendOrder(order).then(function(resp) {
			_.forEach(ids, function(id) {
				model.activeAutoPauses[id] = !model.userPauses[id] && paused;
			});
		});
	};
	
	var findBuildTargetId = function(state) {
		return state.build_target || 
			(state.orders && 
				state.orders.length > 0 && 
				state.orders[0].type === "build" && 
				state.orders[0].target ? 
					state.orders[0].target.entity : undefined);
	};
	
	var getMetalEmptyTime = function(currentNet) {
		var cm = model.currentMetal();
		if (cm < 10) {
			return 0;
		}
		var emptyIn = (cm / currentNet);
		return emptyIn <= 0 ? -emptyIn : Number.MAX_VALUE;
	};
	
	var getEnergyEmptyTime = function(currentNet) {
		var cm = model.currentEnergy();
		if (cm < 100) {
			return 0;
		}
		var emptyIn = (cm / currentNet);
		return emptyIn <= 0 ? -emptyIn : Number.MAX_VALUE;
	};
	
	var containsPrioTargets = function(units) {
		for (var i = 0; i < units.length; i++) {
			if (model.userPriorities[units[i]]) {
				return true;
			}
		}
		return false;
	};
	
	var shouldPauseByAutomatic = function(id, spec, state, buildTargetState, metalEmptyTimePrios, energyEmptyTimePrios, metalEmptyTimeAll, energyEmptyTimeAll,  hasPrios) {
		var isPrio = !hasPrios || model.userPriorities[id];
		var nonConstructor = !isType(spec, "Construction") && !isType("Factory");
		var byMetal = (isPrio ? metalEmptyTimePrios : metalEmptyTimeAll) < (isPrio ? prioLevel : noPrioLevel);
		var byEnergy = (!isPrio && energyEmptyTimeAll < noPrioLevel) || (nonConstructor && (isPrio ? energyEmptyTimePrios : energyEmptyTimeAll) < (isPrio ? prioLevel : noPrioLevel));
		
		var needsMetal = specEconomyMapping[spec].metalUse > 0;
		var needsEnergy = specEconomyMapping[spec].energyUse > 0;
		 
		var byRes = (needsMetal && byMetal) || (needsEnergy && byEnergy);
		
		if (state.orders && state.orders.length > 0) {
			var btarget = findBuildTargetId(state);
			if (state.orders[0].type === "reclaim" || 
					(btarget && wallIds[btarget])) {
				return false;
			} else if (buildTargetState !== undefined) {
				return buildTargetState.built_frac && buildTargetState.built_frac > 0.03 && byRes;
			} else {
				return byRes;
			}
		} else {
			return byRes;
		}
	};
	
	var lastMetalNet = 0;
	
	model.applyPauseStates = function() {
		if (model.enableAutomatic() && model.hasFirstResourceUpdate()) {
			model.withAllUnitBySpec(function(spec, ids) {
				if (managedSpecs[spec]) {
					var pausedIds = [];
					var unpausedIds = [];
					for (var i = 0; i < ids.length; i++) {
						if (model.getPauseState(ids[i])) {
							pausedIds.push(ids[i]);
						} else {
							unpausedIds.push(ids[i]);
						}
					}
					setPauseViaIDs(pausedIds, true);
					setPauseViaIDs(unpausedIds, false);
					lastMetalNet = model.metalNet();
				}
			});
		}
	};
	
	model.recheckAutomatic = function() {
		if (model.enableAutomatic() && model.hasFirstResourceUpdate()) {
			var spawnCalls = 0;
			var finishCalls = 0;
			var unitData = [];
			var checkAllDataReady = function() {
				finishCalls++;
				if (spawnCalls === finishCalls) {
					var pMetalNetPrio = model.metalNet();
					var pMetalNetAll = model.metalNet();
					var pEnergyNetPrio = model.energyNet();
					var pEnergyNetAll = model.energyNet();
					var allPrioCandidateIds = [];
					_.forEach(unitData, function(ud) {
						for (var i = 0; i < ud.builders.length; i++) {
							allPrioCandidateIds.push(ud.builders[i]);
						}
					});
					var hasPrioTargets = containsPrioTargets(allPrioCandidateIds);
					_.forEach(unitData, function(ud) {
						for (var i = 0; i < ud.builders.length; i++) {
							var isPrio = !hasPrioTargets || model.userPriorities[ud.builders[i]];
							var mu = specEconomyMapping[ud.spec].metalUse || 0;
							var eu = specEconomyMapping[ud.spec].energyUse || 0;
							if (model.activeAutoPauses[ud.builders[i]]) {
								if (isPrio) {
									pMetalNetPrio -= mu;
									pEnergyNetPrio -= eu;
								}
								pMetalNetAll -= mu;
								pEnergyNetAll -= eu;
							} else {
								if (!isPrio) {
									pMetalNetPrio += mu;
									pEnergyNetPrio += eu;
								}
							}
						}
					});
					// TODO race condition: metalNet() is not perfectly consistent with the missing usage. Not sure if I can even do anything against that
					var metalEmptyTimePrios = getMetalEmptyTime(pMetalNetPrio);
					var energyEmptyTimePrios = getEnergyEmptyTime(pEnergyNetPrio);
					var metalEmptyTimeAll = getMetalEmptyTime(pMetalNetAll);
					var energyEmptyTimeAll = getEnergyEmptyTime(pEnergyNetAll);
					
					_.forEach(unitData, function(ud) {
						for (var i = 0; i < ud.builders.length; i++) {
							model.autoPauses[ud.builders[i]] = shouldPauseByAutomatic(ud.builders[i], ud.spec, ud.builderStates[i],
									ud.buildTargetStates[i], metalEmptyTimePrios, energyEmptyTimePrios, metalEmptyTimeAll, energyEmptyTimeAll, hasPrioTargets);
						}
						for (var i = 0; i < ud.nonbuilders.length; i++) {
							model.autoPauses[ud.nonbuilders[i]] = shouldPauseByAutomatic(ud.nonbuilders[i], ud.spec, ud.nonbuilderStates[i],
									undefined, metalEmptyTimePrios, energyEmptyTimePrios, metalEmptyTimeAll, energyEmptyTimeAll, hasPrioTargets);
						}
					});
					
					model.applyPauseStates();
				}
			};
			model.withAllUnitBySpec(function(spec, ids) {
				if (managedSpecs[spec]) {
					spawnCalls++;
					world.getUnitState(ids).then(function(state) {
						try {
							var builders = [];
							var builderStates = [];
							var nonbuilders = [];
							var nonbuilderStates = [];
							var buildTargetIds = [];
							for (var i = 0; i < ids.length; i++) {
								var bt = findBuildTargetId(state[i]);
								if (bt) {
									builders.push(ids[i]);
									builderStates.push(state[i]);
									buildTargetIds.push(bt);
								} else {
									nonbuilders.push(ids[i]);
									nonbuilderStates.push(state[i]);
								}
							}
							var u = {
								spec: spec,
								builders: builders,
								builderStates: builderStates,
								buildTargetStates: [],
								nonbuilders: nonbuilders,
								nonbuilderStates: nonbuilderStates
							};
							if (buildTargetIds.length > 0) {
								world.getUnitState(buildTargetIds).then(function(bState) {
									try {
										u.buildTargetStates = bState;
										unitData.push(u);
										checkAllDataReady();
									} catch (e) {
										console.log(e.stack);
									}
								});
							} else {
								unitData.push(u);
								checkAllDataReady();
							}
						} catch (e) {
							console.log(e.stack);
						}
					});
				}
			});
		} else {
			model.autoPauses = {}; 
		}
	};
	
	setInterval(function() {
		model.recheckAutomatic();
	}, workInterval);
	
	handlers.enableManagement = model.gameActive;
	
	handlers.setRelevantData = function(payload) {
		armyIndex = payload.armyIndex;
		planets = payload.planets;
	};
	
	api.Panel.message(api.Panel.parentId, 'queryFreeEconomyInfo');
}());