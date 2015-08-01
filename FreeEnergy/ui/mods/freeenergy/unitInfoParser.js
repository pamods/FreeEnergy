// enhanced version: considers tools to be part of the unit-definition tree. They are located directly below the spec that holds them and also parse their base specs.
// if a unit has a tool twice that tool will be encountered twice in the tree.
var unitInfoParser2 = 
	(typeof unitInfoParser2 === "undefined") ?
	(function() {
			var _coherentHost = "coui://";
			var _unitListPath = _coherentHost+"pa/units/unit_list.json";
			
			// function parses all units, following unit bases recursively
			// onComplete is given the finished map of spec => custom piece of data per spec
			// dataGetter gets the data from the unit json, it expects one parameter: the parsed unit json
			// datamerger expected two parameters, the data further up the definition tree of the unit and further down
			// examples see the next 2 functions after this
			// the point "most up" is the unit file
			// the point "most down" is the base spec of the base spec of the ... 
			var _loadUnitData = function(onComplete, dataGetter, dataMerger) {
			  var resultTypeMapping = {};
			  var spawnedUnitCalls = 0;
			  $.getJSON(_unitListPath, function(data) {
			   var units = data.units;
			   var finishedAll = false;
			   
			   var countDown = function() {
				  spawnedUnitCalls--;
				  if (spawnedUnitCalls === 0) {
					onComplete(resultTypeMapping);
				  }
			   };
			   
			   function readUnitDataFromFile(file, callback, innerCall) {
				  $.getJSON(file, function(unit) {
					var freshDataFromUnit = dataGetter(unit);
					var baseSpec = unit.base_spec;
					
					var procFurther = function(mergeBase) {
						if (baseSpec != undefined) {
							readUnitDataFromFile(_coherentHost + baseSpec, function(unitData) {
								callback(dataMerger(mergeBase, unitData));
							}, innerCall);
						} else {
							if (innerCall || mergeBase !== undefined) {
								callback(mergeBase);
							}
							if (!innerCall) {
								countDown();
							}
						}
					};
					
					var tools = unit.tools;
					if (tools !== undefined && tools.length > 0) {
						var cp = [];
						for (var i = 0; i < tools.length; i++) {
							if (tools[i].spec_id) {
								cp.push(tools[i].spec_id);
							}
						}
						if (cp.length > 0) {
							var t = cp.pop();
							var mergeBase = freshDataFromUnit;
							var doTool = function() {
								readUnitDataFromFile(_coherentHost + t, function(toolData) {
									if (toolData) {
										mergeBase = dataMerger(mergeBase, toolData);
									}
									t = cp.pop();
									if (t) {
										doTool();
									} else {
										procFurther(mergeBase);
									}
								}, true);
							};
							doTool();
						} else {
							procFurther(freshDataFromUnit);
						}
					} else {
						procFurther(freshDataFromUnit);
					}
				  }).fail(function(e) {
					  console.log("PA Stats or some other mod that is using unitInfoParser2.js found an invalid unit json file: "+file+", both PA itself and PA Stats will probably choke and die when such units are build.");
					  countDown();
				  });
				}
				 
				spawnedUnitCalls = units.length;
				function processUnitPath(unitPath) {
				  readUnitDataFromFile(_coherentHost+unitPath, function(unitData) {
					resultTypeMapping[unitPath] = unitData;
				  });
				}
				for (var i = 0; i < units.length; i++) {
				  processUnitPath(units[i]);
				}
			  });
			};
			
			// load an array with a list of all known unittypes. duplicates are filtered out
			var _loadUnitTypesArray = function(onComplete) {
				loadUnitTypeMapping(function(mapping) {
				var types = [];
				for (unit in mapping) {
				  types = types.concat(mapping[unit]);
				}
				types = types.filter(function(elem, pos) {
				  return types.indexOf(elem) == pos;
				});
				onComplete(types);
			  });
			};
			
			//creates a map of all unit specs to their display name
			var _loadUnitNamesMapping = function(onComplete) {
			  _loadUnitData(onComplete, function(unit) {
				return unit.display_name;
			  }, function (dataUpTheTree, dataDownTheTree) {
				return dataUpTheTree; // first name encountered is used
			  });
			};
			
			//creates a map of all unit spec to an array of their type
			var _loadUnitTypeMapping = function(onComplete) {
			  _loadUnitData(onComplete, function(unit) {
				var unitTypes = unit.unit_types;
				if (unitTypes != undefined) {
				  for (var u = 0; u < unitTypes.length; u++) {
					unitTypes[u] = unitTypes[u].replace("UNITTYPE_", "");
				  }
				}
				return unitTypes;
			  }, function(dataUpTheTree, dataDownTheTree) {
				if (dataUpTheTree === undefined) {
				  dataUpTheTree = [];
				}
				if (dataDownTheTree === undefined) {
				  dataDownTheTree = [];
				}
				return dataUpTheTree.concat(dataDownTheTree);
			  });
			};
			
			var _loadUnitEconomyDataMapping = function(onComplete) {
				unitInfoParser2.loadUnitData(onComplete, function(unit) {
					var vals = {
						energyGain: undefined,
						energyUse: undefined,
						metalGain: undefined,
						metalUse: undefined
					};
					
					var pz = function(v) {
						return v === undefined ? 0 : v;
					};
					
					if (unit.production) {
						if (unit.production.metal) {
							vals.metalGain = pz(vals.metalGain);
							vals.metalGain += unit.production.metal;
						}
						if (unit.production.energy) {
							vals.energyGain = pz(vals.energyGain);
							vals.energyGain += unit.production.energy;
						}
					}
					
					if (unit.consumption) {
						if (unit.consumption.metal) {
							vals.metalUse = pz(vals.metalUse);
							vals.metalUse += unit.consumption.metal;
						}
						if (unit.consumption.energy) {
							vals.energyUse = pz(vals.energyUse);
							vals.energyUse +=  unit.consumption.energy;
						}
					}
					
					if (unit.teleporter) {
						if (unit.teleporter.energy_demand) {
							vals.energyUse = pz(vals.energyUse);
							vals.energyUse += unit.teleporter.energy_demand;
						}
					}
					
					if (unit.construction_demand) {
						if (unit.construction_demand.energy) {
							vals.energyUse = pz(vals.energyUse);
							vals.energyUse += unit.construction_demand.energy;
						}
						if (unit.construction_demand.metal) {
							vals.metalUse = pz(vals.metalUse);
							vals.metalUse += unit.construction_demand.metal;
						}
					}
					
					vals.buildRange = unit.max_range;
					
					vals.energyReq = unit.energy_efficiency_requirement;
					return vals;
				}, function(up, down) {
					up.metalGain = up.metalGain !== undefined ? up.metalGain : down.metalGain;
					up.energyGain = up.energyGain !== undefined ? up.energyGain : down.energyGain;
					up.metalUse = up.metalUse !== undefined ? up.metalUse : down.metalUse;
					up.energyUse =  up.energyUse !== undefined ? up.energyUse : down.energyUse;
					up.energyReq = up.energyReq !== undefined ? up.energyReq : down.energyReq;
					up.buildRange = up.buildRange !== undefined ? up.buildRange : down.buildRange;
					return up;
				});
			};
			
			return {
				loadUnitData: _loadUnitData,
				loadUnitTypesArray: _loadUnitTypesArray,
				loadUnitNamesMapping: _loadUnitNamesMapping,
				loadUnitTypeMapping: _loadUnitTypeMapping,
				loadUnitEconomyDataMapping: _loadUnitEconomyDataMapping
			};
		}()) : unitInfoParser2;
