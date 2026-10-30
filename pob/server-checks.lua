-- PoE Upgrade Checker <-> Path of Building bridge: the checks the app asks for now and then
-- (a gem, anoints, bosses, runes, better bases, a trade search from the build). Loaded by server.lua,
-- which hands over the few helpers they share; Path of Building's own globals (build, data...) are
-- the same in both files.
local S = ...
local GAME, num, pick, makeItem, pobSlot = S.GAME, S.num, S.pick, S.makeItem, S.pobSlot

-- PoE1 loot filter: the affix names ("Virile", "of the Rainbow") of the higher tiers of trade stats,
-- for mods that can roll on an item with these tags (ring, amulet, belt, helmet, gloves...).
--   req: { ids = { "explicit.stat_3299347043", ... }, tags = { "ring" }, tiers = 3 } -> { [id] = { {affix, level, type}, ... } }
-- a skill or support gem you copied, at its level and quality, in place of the same gem in your build
-- (every group that uses it): what it changes. { name, level, quality } -> { before, hits = { {group, level, quality, after} } }
local function gemCheck(req)
  local want = tostring(req.name or ""):lower()
  -- the game calls supports "Impale Support"; Path of Building calls them "Impale"
  local wantShort = want:gsub("%s+support$", "")
  if want == "" then return { ok = false, error = "no gem" } end
  local calcFunc, base = build.calcsTab:GetMiscCalculator()
  local hits = {}
  for _, g in ipairs(build.skillsTab.socketGroupList or {}) do
    if g.enabled ~= false then
      for _, gem in ipairs(g.gemList or {}) do
        local ge = gem.grantedEffect or (gem.gemData and gem.gemData.grantedEffect)
        local nm = (gem.gemData and gem.gemData.name) or gem.nameSpec or (ge and ge.name)
        if nm and (tostring(nm):lower() == want or tostring(nm):lower() == wantShort) and gem.enabled ~= false then
          local oldL, oldQ = gem.level, gem.quality
          if req.level then gem.level = req.level end
          if req.quality then gem.quality = req.quality end
          local ok, after = pcall(calcFunc, {})
          gem.level, gem.quality = oldL, oldQ
          hits[#hits + 1] = { group = g.displayLabel or g.label, level = oldL, quality = oldQ, after = ok and pick(after) or nil, error = (not ok) and tostring(after) or nil }
        end
      end
    end
  end
  return { ok = true, before = pick(base), hits = hits }
end

-- anoint (PoE1) / instill (PoE2): every notable that can go on an amulet, tried in place of the amulet's
-- current one (as Path of Building's own anoint list does). Notables already on your tree are skipped.
--   { seconds = 40 } -> { before, now = { "Name" }, results = { {name, stats, recipe, after} }, checked, total }
local function anointCheck(req)
  local slot = build.itemsTab.slots["Amulet"]
  local cur = slot and slot.selItemId and build.itemsTab.items[slot.selItemId]
  -- no amulet in the build: a plain one, so the notables still compare
  local raw = cur and cur:BuildRaw() or "Rarity: NORMAL\nGold Amulet\n"
  if not cur then cur = makeItem(raw) end
  if not cur then return { ok = false, error = "Your build has no amulet." } end
  local function anointed(node)
    local item = makeItem(raw)
    if not item then return nil end
    local keep = {}
    for _, l in ipairs(item.enchantModLines or {}) do if not tostring(l.line or ""):match("^Allocates ") then keep[#keep + 1] = l end end
    item.enchantModLines = keep
    if node then table.insert(item.enchantModLines, 1, { enchant = true, line = "Allocates " .. node.dn }) end
    item:BuildAndParseRaw()
    return item
  end
  local now = {}
  for _, l in ipairs(cur.enchantModLines or {}) do local n = tostring(l.line or ""):match("^Allocates (.+)$"); if n then now[#now + 1] = n end end
  local calcFunc = build.calcsTab:GetMiscCalculator()
  local bare = anointed(nil)
  if not bare then return { ok = false, error = "Path of Building couldn't read your amulet." } end
  local okb, base = pcall(calcFunc, { repSlotName = "Amulet", repItem = bare })
  if not okb then return { ok = false, error = tostring(base) } end
  local list, checked, total = {}, 0, 0
  local deadline = os.clock() + (tonumber(req.seconds) or 40)
  local alloc = build.spec.allocNodes or {}
  for id, node in pairs(build.spec.tree.nodes or {}) do
    if node.recipe and #node.recipe >= 1 and node.dn and node.modKey ~= "" and not alloc[id] then
      total = total + 1
      if os.clock() < deadline then
        checked = checked + 1
        local item = anointed(node)
        local ok, o = false, nil
        if item then ok, o = pcall(calcFunc, { repSlotName = "Amulet", repItem = item }) end
        if ok then list[#list + 1] = { name = node.dn, stats = node.sd, recipe = node.recipe, after = pick(o) } end
      end
    end
  end
  return { ok = true, before = pick(base), now = now, results = list, checked = checked, total = total, noAmulet = not (slot and slot.selItemId and build.itemsTab.items[slot.selItemId]) }
end

-- PoE1 boss check: Path of Building's boss skill presets (Configuration → Boss Skill Preset) at the
-- Pinnacle and Uber tiers, one at a time: how many of each hit you can take. Your own configuration is
-- put back afterwards. { tiers = { "Pinnacle", "Uber" } } -> { before, skills = { {name, tier, hits, avgHits, damage} } }
local function bossCheck(req)
  local cfg = build.configTab
  if not (data.bossSkills and data.bossSkillsList and cfg.varControls and cfg.varControls.presetBossSkills) then return { ok = false, error = "this Path of Building has no boss presets" } end
  local set = cfg.configSets[cfg.activeConfigSetId]
  local input, ph = set.input, set.placeholder
  local savedIn, savedPh = copyTable(input), copyTable(ph)
  local function restore()
    wipeTable(input); for k, v in pairs(savedIn) do input[k] = v end
    wipeTable(ph); for k, v in pairs(savedPh) do ph[k] = v end
    local c = cfg.varControls
    if c.enemyIsBoss then c.enemyIsBoss:SelByValue(input.enemyIsBoss or cfg:GetDefaultState("enemyIsBoss"), "val") end
    if c.enemyDamageType then c.enemyDamageType:SelByValue(input.enemyDamageType or cfg:GetDefaultState("enemyDamageType"), "val"); c.enemyDamageType.enabled = true end
    cfg:BuildModList()
  end
  -- your own enemy damage numbers would override the preset's
  local clear = { "enemyDamageType", "enemySpeed", "enemyCritChance", "enemyPhysicalOverwhelm", "enemyLightningPen", "enemyColdPen", "enemyFirePen" }
  for _, t in ipairs({ "Physical", "Lightning", "Cold", "Fire", "Chaos" }) do clear[#clear + 1] = "enemy" .. t .. "Damage" end
  local skills = {}
  local okAll, err = pcall(function()
    for _, tier in ipairs(req.tiers or { "Pinnacle", "Uber" }) do
      for _, entry in ipairs(data.bossSkillsList) do
        local name = entry.val
        if name and name ~= "None" and data.bossSkills[name] then
          for _, k in ipairs(clear) do input[k] = nil end
          input.enemyIsBoss = tier
          cfg.varControls.enemyIsBoss:SelByValue(tier, "val")
          input.presetBossSkills = name
          cfg:BuildModList()
          local calcFunc = build.calcsTab:GetMiscCalculator()
          local ok, o = pcall(calcFunc, {}, false)
          if ok and o then
            local dmg = 0
            for _, t in ipairs({ "Physical", "Lightning", "Cold", "Fire", "Chaos" }) do dmg = dmg + (num(ph["enemy" .. t .. "Damage"]) or 0) end
            skills[#skills + 1] = { name = name, tier = tier, hits = num(o.NumberOfMitigatedDamagingHits), avgHits = num(o.TotalNumberOfHits), damage = dmg > 0 and dmg or nil, damageType = data.bossSkills[name].DamageType }
          else
            skills[#skills + 1] = { name = name, tier = tier, error = tostring(o) }
          end
        end
      end
    end
  end)
  restore()
  if not okAll then return { ok = false, error = tostring(err) } end
  return { ok = true, skills = skills }
end

local function affixNames(req)
  local want = {}
  for _, id in ipairs(req.ids or {}) do local h = tostring(id):match("stat_(%d+)$"); if h then want[tonumber(h)] = id end end
  local tags = {}
  for _, t in ipairs(req.tags or {}) do tags[t] = true end
  -- an item's own base: the tags its mods roll with (str_armour, wand, two_hand_weapon...)
  local b = req.base and data.itemBases and data.itemBases[req.base]
  if b and b.tags then for t, on in pairs(b.tags) do if on then tags[t] = true end end end
  local function spawns(mod)
    for i, k in ipairs(mod.weightKey or {}) do
      if tags[k] or k == "default" then return (mod.weightVal and mod.weightVal[i] or 0) > 0 end
    end
    return false
  end
  local found = {}
  for _, mod in pairs((data.itemMods and data.itemMods.Item) or {}) do
    if (mod.type == "Prefix" or mod.type == "Suffix") and mod.affix and mod.tradeHashes and spawns(mod) then
      for hash in pairs(mod.tradeHashes) do
        local id = want[tonumber(hash)]
        if id then found[id] = found[id] or {}; table.insert(found[id], { affix = mod.affix, level = mod.level or 0, type = mod.type }) end
      end
    end
  end
  local tiers = tonumber(req.tiers) or 3
  local out = {}
  for id, list in pairs(found) do
    table.sort(list, function(a, b) return a.level > b.level end)
    local seen, top = {}, {}
    for _, m in ipairs(list) do
      if not seen[m.affix] then seen[m.affix] = true; top[#top + 1] = m end
      if #top >= tiers then break end
    end
    out[id] = top
  end
  return { ok = true, affixes = out }
end

-- Path of Building's own trade search generator ("Trader"): it tries every mod that can roll on
-- the slot's item type on your build and weights each by how much it raises your damage and
-- effective HP, then builds a weighted trade search from that.
--   req: { slot = "Gloves", weights = { {stat="MinionCombinedDPS", weightMult=0.6}, ... }, maxPrice, maxPriceType }
-- each skill group's damage when it's the main skill (what Path of Building shows if you pick it),
-- so you can see which skill a build really runs on. The main skill is put back afterwards.
--   -> { main = index, skills = { {index, label, enabled, full, dps, key, minion} } }
local function skillDps()
  local list = build.skillsTab.socketGroupList or {}
  local was = build.mainSocketGroup
  local out = {}
  local function recalc() build.buildFlag = true; runCallback("OnFrame") end
  for i, g in ipairs(list) do
    if g.enabled ~= false and g.gemList and #g.gemList > 0 then
      build.mainSocketGroup = i
      local ok, err = pcall(recalc)
      local o = build.calcsTab.mainOutput or {}
      local minion = num(o.Minion and o.Minion.CombinedDPS) or 0
      local own = num(o.CombinedDPS) or num(o.TotalDPS) or 0
      local dps, key = own, "CombinedDPS"
      if minion > own then dps, key = minion, "MinionDPS" end
      local first = g.gemList[1]
      out[#out + 1] = { index = i, label = g.displayLabel or g.label, gemId = first and first.gemId or nil, gemName = first and (first.nameSpec or (first.gemData and first.gemData.name)) or nil, full = g.includeInFullDPS and true or false, dps = ok and dps or nil, key = key, minion = minion > own, error = (not ok) and tostring(err) or nil,
        full_dps = num(o.FullDPS) }
    end
  end
  build.mainSocketGroup = was
  pcall(recalc)
  return { ok = true, main = was, skills = out }
end

-- PoE2 runes and soul cores: every one that fits a socket on your gear, tried in that socket in place
-- of what's there. Only the best tier of each kind your level can use is tried ("Greater Desert Rune"
-- over "Lesser Desert Rune"). Gear with no socket that isn't corrupted is tried with one added
-- (an Artificer's Orb). { level, seconds } ->
--   { before, slots = { {slot, item, sockets, added, current = {names}, results = { {socket, rune, type, req, lines, after} }} } }
local RUNE_SLOTS = { "Weapon 1", "Weapon 2", "Helmet", "Body Armour", "Gloves", "Boots" }
local function runeKind(name)
  return (tostring(name):gsub("^Lesser ", ""):gsub("^Greater ", ""):gsub("^Perfect ", ""))
end
local function withRunes(raw, count, runes)
  local item = makeItem(raw)
  if not item then return nil end
  item.itemSocketCount = count
  item.runes = {}
  for i = 1, count do item.runes[i] = runes[i] or "None" end
  item:UpdateRunes()
  item:BuildAndParseRaw()
  return item
end
local function runeCheck(req)
  if GAME == "poe1" then return { ok = false, error = "Runes are a Path of Exile 2 thing." } end
  local level = tonumber(req.level) or build.characterLevel or 100
  local deadline = os.clock() + (tonumber(req.seconds) or 50)
  local calcFunc = build.calcsTab:GetMiscCalculator()
  local base = calcFunc({})
  local out = {}
  for _, name in ipairs(RUNE_SLOTS) do
    local slot = build.itemsTab.slots[pobSlot(name)]
    local cur = slot and slot.selItemId and build.itemsTab.items[slot.selItemId]
    if cur and cur.base and (cur.base.weapon or cur.base.armour or cur.base.tags.wand or cur.base.tags.staff or cur.base.tags.sceptre or (cur.itemSocketCount or 0) > 0) then
      -- a corrupted item can't be changed: its runes stay
      if cur.corrupted then goto continue end
      local count = cur.itemSocketCount or 0
      local added, unknown = false, false
      if count == 0 then
        if #(cur.runeModLines or {}) > 0 then
          -- rune mods but no "Sockets:" line (an item saved by an older version): one socket, rune unknown
          count, unknown = 1, true
        else count, added = 1, true end
      end
      local raw = cur:BuildRaw()
      local current = {}
      for i = 1, count do current[i] = unknown and "?" or (cur.runes and cur.runes[i]) or "None" end
      -- the best tier of each kind you can use
      local best = {}
      for _, r in ipairs(build.itemsTab:GetValidRunesForItem(cur)) do
        if r.name ~= "None" and not r.isSocketBound and (r.req or 0) <= level then
          local k = runeKind(r.name)
          if not best[k] or (r.req or 0) > (best[k].req or 0) then best[k] = r end
        end
      end
      -- each result is compared with your gear as you wear it (the "before")
      local entry = { slot = name, item = cur.title or cur.name, sockets = count, added = added, unknown = unknown, current = current, results = {} }
      -- runes it can't name: your gear with the socket empty, so the app can say what your rune gives now
      if unknown then
        entry.runeLines = {}
        for _, l in ipairs(cur.runeModLines or {}) do entry.runeLines[#entry.runeLines + 1] = tostring(l.line or "") end
        local okb, b = pcall(function() local it = withRunes(raw, count, {}); return it and calcFunc({ repSlotName = pobSlot(name), repItem = it }) end)
        if okb and b then entry.bare = pick(b) end
      end
      for i = 1, count do
        for _, r in pairs(best) do
          if os.clock() > deadline then entry.partial = true; break end
          if r.name ~= current[i] then
            local runes = {}
            for j = 1, count do runes[j] = (current[j] ~= "?" and current[j]) or "None" end
            runes[i] = r.name
            local ok, after = pcall(function() local it = withRunes(raw, count, runes); return it and calcFunc({ repSlotName = pobSlot(name), repItem = it }) end)
            if ok and after then
              entry.results[#entry.results + 1] = { socket = i, rune = r.name, type = r.type, req = r.req, lines = r.lines, after = pick(after) }
            end
          end
        end
      end
      out[#out + 1] = entry
    end
    ::continue::
  end
  return { ok = true, before = pick(base), level = level, slots = out }
end
-- several rune picks together: { picks = { {slot, socket, rune} } } -> { before, after }
local function runeApply(req)
  if GAME == "poe1" then return { ok = false, error = "Runes are a Path of Exile 2 thing." } end
  local calcFunc = build.calcsTab:GetMiscCalculator()
  local base = calcFunc({})
  local bySlot = {}
  for _, p in ipairs(req.picks or {}) do bySlot[p.slot] = bySlot[p.slot] or {}; bySlot[p.slot][tonumber(p.socket) or 1] = p.rune end
  local override = {}
  for name, picks in pairs(bySlot) do
    local slot = build.itemsTab.slots[pobSlot(name)]
    local cur = slot and slot.selItemId and build.itemsTab.items[slot.selItemId]
    if cur then
      local count = math.max(cur.itemSocketCount or 0, 1)
      local runes = {}
      for i = 1, count do runes[i] = picks[i] or (cur.runes and cur.runes[i]) or "None" end
      local it = withRunes(cur:BuildRaw(), count, runes)
      if it then override[#override + 1] = { slot = pobSlot(name), item = it } end
    end
  end
  -- every slot at once: swap them in, calculate, put the old items back whatever happens
  local saved = {}
  local okc, after = pcall(function()
    for _, o in ipairs(override) do
      local slot = build.itemsTab.slots[o.slot]
      saved[#saved + 1] = { slot = slot, id = slot.selItemId, item = o.item }
      build.itemsTab:AddItem(o.item, true)
      slot:SetSelItemId(o.item.id)
    end
    build.itemsTab:PopulateSlots(); build.buildFlag = true; runCallback("OnFrame")
    local calc2 = build.calcsTab:GetMiscCalculator()
    return pick(calc2({}))
  end)
  for _, sv in ipairs(saved) do
    sv.slot:SetSelItemId(sv.id or 0)
    if build.itemsTab.DeleteItem then pcall(build.itemsTab.DeleteItem, build.itemsTab, sv.item) end
  end
  build.itemsTab:PopulateSlots(); build.buildFlag = true; runCallback("OnFrame")
  if not okc then return { ok = false, error = tostring(after) } end
  return { ok = true, before = pick(base), after = after }
end

-- loot filter: bases of the same kind as each one you wear (same item type, same defence mix or
-- weapon type, same implicit) with more base defence or weapon damage, that you can use now or soon.
-- Runeforged and unobtainable bases are left out (they don't drop).
--   { level, ahead = 5, slots = { {slot, base} } } -> { slots = { {slot, base, score, better = { {name, score, level} }} } }
local function baseScore(b)
  if b.armour then
    local t = 0
    for k, v in pairs(b.armour) do if k == "Armour" or k == "Evasion" or k == "EnergyShield" then t = t + (tonumber(v) or 0) end end
    return t
  elseif b.weapon then
    local w, t = b.weapon, 0
    for _, ty in ipairs({ "Physical", "Fire", "Cold", "Lightning", "Chaos" }) do t = t + ((tonumber(w[ty .. "Min"]) or 0) + (tonumber(w[ty .. "Max"]) or 0)) / 2 end
    return t * (tonumber(w.AttackRateBase) or 1)
  end
  return nil
end
local function betterBases(req)
  local level = tonumber(req.level) or build.characterLevel or 100
  local ahead = tonumber(req.ahead) or 5
  local out = {}
  for _, s in ipairs(req.slots or {}) do
    local cur = data.itemBases[s.base]
    local entry = { slot = s.slot, base = s.base, better = {} }
    local sc = cur and baseScore(cur)
    if cur and sc and sc > 0 then
      entry.score = sc
      for name, b in pairs(data.itemBases) do
        if name ~= s.base and not b.hidden and not (b.tags and b.tags.runeforged) and b.type == cur.type and b.subType == cur.subType and b.implicit == cur.implicit then
          local lv = (b.req and b.req.level) or 1
          local v = baseScore(b)
          if v and v > sc * 1.05 and lv <= level + ahead then entry.better[#entry.better + 1] = { name = name, score = v, level = lv } end
        end
      end
      table.sort(entry.better, function(a, b) return a.score > b.score end)
      while #entry.better > 4 do table.remove(entry.better) end
    end
    out[#out + 1] = entry
  end
  return { ok = true, level = level, slots = out }
end

local function genQuery(req)
  local slot = build.itemsTab.slots[pobSlot(req.slot)]
  if not slot then return { ok = false, error = "unknown slot " .. tostring(req.slot) } end
  -- PoB2 takes the arguments in new(); PoB1 wants them in the constructor call
  local okg, gen = pcall(new, "TradeQueryGenerator", { itemsTab = build.itemsTab })
  if not okg then gen = new("TradeQueryGenerator"):TradeQueryGenerator({ itemsTab = build.itemsTab }) end
  local result, err
  gen.requesterCallback = function(_, q, e) result = q; err = e end
  gen.requesterContext = {}
  local weights = {}
  for _, w in ipairs(req.weights or {}) do weights[#weights + 1] = { stat = w.stat, weightMult = w.weightMult, label = w.stat } end
  if #weights == 0 then weights = { { stat = "FullDPS", weightMult = 1.0 }, { stat = "TotalEHP", weightMult = 0.5 } } end
  local options = {
    statWeights = weights, includeCorrupted = req.includeCorrupted ~= false, includeMirrored = false, includeRunes = false,
    -- PoE1 only (PoB2 ignores them)
    includeEldritch = req.includeEldritch or "None", includeScourge = req.includeScourge, includeTalisman = req.includeTalisman,
    influence1 = req.influence1 or 1, influence2 = req.influence2 or 1, -- 1: no influence
    maxPrice = req.maxPrice, maxPriceType = req.maxPriceType, jewelType = req.jewelType or "Base",
  }
  local t0 = os.clock()
  gen:StartQuery(slot, options)
  local frames = 0
  while gen.calcContext and gen.calcContext.co and frames < 1000000 do gen:OnFrame(); frames = frames + 1 end
  if not result then return { ok = false, error = err or "Path of Building could not build a search for this slot" } end
  -- the per-mod weights it found, for showing and for trimming the search to the site's limits
  local mw = {}
  for i, e in ipairs(gen.modWeights or {}) do
    if i > 60 then break end
    mw[#mw + 1] = { id = e.tradeModId, weight = e.weight, invert = e.invert or nil, mean = e.meanStatDiff }
  end
  return { ok = true, query = result, error = err, modWeights = mw, seconds = os.clock() - t0 }
end

-- Every unique in Path of Building's item database that fits a slot, tried in your build there (in
-- each slot it fits, the best kept), like PoB's own unique list sorted by what an item does for you.
-- Uniques are the one kind of item the weighted trade search leaves out.
--   req: { slots = { "Ring 1", "Ring 2" }, maxLevel = 0 } -> { before, list = { {name, base, level, slot, text, after} } }
local function bestUniques(req)
  local calcFunc, base = build.calcsTab:GetMiscCalculator()
  local maxLevel = tonumber(req.maxLevel) or 0
  local slots = {}
  for _, s in ipairs(req.slots or {}) do
    local slot = build.itemsTab.slots[pobSlot(s)]
    if slot then slots[#slots + 1] = { name = s, pob = slot.slotName } end
  end
  if #slots == 0 then return { ok = false, error = "unknown slot" } end
  local out, seen = {}, {}
  for _, list in pairs(data.uniques or {}) do
    for _, raw in pairs(list) do
      local item = makeItem(raw)
      local name = item and (item.title or item.name)
      if item and item.base and name and not seen[name] then
        local lvl = item.requirements and tonumber(item.requirements.level) or 0
        if maxLevel <= 0 or lvl <= maxLevel then
          local best
          for _, s in ipairs(slots) do
            if build.itemsTab:IsItemValidForSlot(item, s.pob) then
              local ok, new_ = pcall(calcFunc, { repSlotName = s.pob, repItem = item })
              if ok and new_ then
                local after = pick(new_)
                local z = function(v) return num(v) or 0 end
                local dps = math.max(z(new_.FullDPS), z(new_.CombinedDPS), z(new_.Minion and new_.Minion.CombinedDPS))
                local key = dps / math.max(1, z(base.FullDPS) + z(base.CombinedDPS) + z(base.Minion and base.Minion.CombinedDPS)) + z(new_.TotalEHP) / math.max(1, z(base.TotalEHP)) * 0.5
                if not best or key > best.key then best = { slot = s.name, after = after, key = key } end
              end
            end
          end
          if best then
            seen[name] = true
            out[#out + 1] = { name = name, base = item.baseName, level = lvl, slot = best.slot, text = raw, after = best.after }
          end
        end
      end
    end
  end
  return { ok = true, before = pick(base), list = out }
end

return { gemCheck = gemCheck, anointCheck = anointCheck, bossCheck = bossCheck, affixNames = affixNames, skillDps = skillDps,
  runeCheck = runeCheck, runeApply = runeApply, betterBases = betterBases, genQuery = genQuery, bestUniques = bestUniques }
