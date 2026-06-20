// ============================================================
// WRCAPI – v2 – zoptymalizowany cache wielopoziomowy
// ============================================================
// Poziomy cache (od najszybszego):
//   L1 – in-memory (ta sama zakładka, ta sama sesja)
//   L2 – localStorage (między zakładkami, między stronami)
//   L3 – JSONBin (tylko gdy L2 wygasł lub force=true)
//
// Obliczenia (championship, constructors, power stage) są
// cache'owane osobno i unieważniane TYLKO gdy dane się zmieniły.
// Status połączenia pochodzi z odpowiedzi loadData()
// – żadnych osobnych zapytań HEAD.
// ============================================================

class WRCAPI {
    constructor() {
        this.config       = CONFIG;
        this.data         = null;
        this.isLoading    = false;
        this.loadPromise  = null;

        // L1 – in-memory cache surowych danych + obliczeń
        this._l1          = {};
        this._l1Time      = 0;
        this._L1_TTL      = 300000000; // 5 min

        // L2 – localStorage (klucze)
        this._LS_DATA     = 'wrc_data_v2';
        this._LS_META     = 'wrc_meta_v2';
        this._LS_CALC     = 'wrc_calc_v2';
        this._L2_TTL      = 600000; // 10 min

        this._etag        = null;
        this._connectionStatus = 'unknown';
        this._statusListeners  = [];

        // Wczytaj L2 synchronicznie przy starcie
        this._hydrateFromStorage();
    }

    // ── L2: localStorage ─────────────────────────────────────────────────────

    _hydrateFromStorage() {
        try {
            const meta = JSON.parse(localStorage.getItem(this._LS_META) || 'null');
            if (!meta || (Date.now() - meta.ts) > this._L2_TTL) return;
            const raw = localStorage.getItem(this._LS_DATA);
            if (!raw) return;
            this.data     = JSON.parse(raw);
            this._l1.data = this.data;
            this._l1Time  = meta.ts;
            this._etag    = meta.etag || null;

            // Wczytaj obliczenia jeśli pochodzą z tej samej wersji danych
            const calcRaw = localStorage.getItem(this._LS_CALC);
            if (calcRaw) {
                const calc = JSON.parse(calcRaw);
                if (calc && calc.ts === meta.ts) {
                    if (calc.championship) this._l1.championship = calc.championship;
                    if (calc.constructors) this._l1.constructors = calc.constructors;
                    if (calc.powerStage)   this._l1.powerStage   = calc.powerStage;
                    if (calc.rallies)      Object.assign(this._l1, calc.rallies);
                }
            }
        } catch (_) {}
    }

    _persistToStorage() {
        try {
            localStorage.setItem(this._LS_DATA, JSON.stringify(this.data));
            localStorage.setItem(this._LS_META, JSON.stringify({ ts: this._l1Time, etag: this._etag }));
            localStorage.removeItem(this._LS_CALC); // dane zmienione – obliczenia nieaktualne
        } catch (_) {}
    }

    _persistCalcToStorage() {
        try {
            const rallies = {};
            Object.keys(this._l1).filter(k => k.startsWith('calc_')).forEach(k => { rallies[k] = this._l1[k]; });
            localStorage.setItem(this._LS_CALC, JSON.stringify({
                ts:           this._l1Time,
                championship: this._l1.championship || null,
                constructors: this._l1.constructors || null,
                powerStage:   this._l1.powerStage   || null,
                rallies
            }));
        } catch (_) {}
    }

    _invalidateStorage() {
        try {
            localStorage.removeItem(this._LS_DATA);
            localStorage.removeItem(this._LS_META);
            localStorage.removeItem(this._LS_CALC);
        } catch (_) {}
    }

    // ── Status połączenia ─────────────────────────────────────────────────────

    onStatusChange(fn) { this._statusListeners.push(fn); }

    _setStatus(s) {
        if (this._connectionStatus === s) return;
        this._connectionStatus = s;
        this._statusListeners.forEach(fn => fn(s));
        document.querySelectorAll('.rallytv-btn').forEach(b => b.setAttribute('data-status', s));
    }

    // Polling: odpytuje JSONBin tylko gdy TTL wygaśnie.
    // visibilitychange zapewnia odświeżenie po powrocie do zakładki.
    startStatusPolling(interval = 300000) {
        if (this.data) this._setStatus('online');

        // Odpytuj co 5 minut (odpyta JSONBin tylko gdy L1/L2 wygaśnie)

        // Odśwież gdy zakładka staje się znów aktywna – bez zbędnych requestów
    }

    stopStatusPolling() {
        if (this._pollingTimer) clearInterval(this._pollingTimer);
        if (this._visibilityHandler)
            document.removeEventListener('visibilitychange', this._visibilityHandler);
    }

    // ── Pobieranie danych (L1 → L2 → JSONBin) ────────────────────────────────

    async loadData(force = false) {
        const now = Date.now();
        if (!force && this.data && (now - this._l1Time) < this._L1_TTL) return this.data;
        if (this.loadPromise) return this.loadPromise;
        this.loadPromise = this._fetchData();
        return this.loadPromise;
    }

    async _fetchData() {
        this.isLoading = true;
        try {
            const headers = { 'X-Master-Key': this.config.JSONBIN.API_KEY };
            if (this._etag) headers['If-None-Match'] = this._etag;

            const response = await fetch(
                `${this.config.JSONBIN.URL}/${this.config.JSONBIN.BIN_ID}/latest`,
                { headers }
            );

            if (response.status === 304) {
                this._l1Time = Date.now();
                this._persistToStorage();
                this._setStatus('online');
                return this.data;
            }

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const newEtag = response.headers.get('ETag') || response.headers.get('etag');
            if (newEtag) this._etag = newEtag;

            const result  = await response.json();
            const newData = result.record;

            // Wykryj czy dane naprawdę się zmieniły – jeśli nie, zachowaj cache obliczeń
            const dataChanged = JSON.stringify(newData) !== JSON.stringify(this.data);
            this.data    = newData;
            this._l1Time = Date.now();

            if (dataChanged) {
                this._l1 = { data: this.data };
                this._dataChangedSinceLastRender = true;
            } else {
                this._l1.data = this.data;
            }

            this._persistToStorage();
            this._setStatus('online');
            return this.data;
        } catch (error) {
            console.error('Błąd wczytywania danych:', error);
            this._setStatus('offline');
            return this.data || null;
        } finally {
            this.isLoading   = false;
            this.loadPromise = null;
        }
    }

    async saveData(data) {
        this.isLoading = true;
        try {
            const response = await fetch(`${this.config.JSONBIN.URL}/${this.config.JSONBIN.BIN_ID}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Master-Key': this.config.JSONBIN.API_KEY
                },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error('Błąd zapisywania danych');
            this.data    = data;
            this._l1     = { data };
            this._l1Time = Date.now();
            this._etag   = null;
            this._invalidateStorage();
            this._persistToStorage();

            try {
                const ch = new BroadcastChannel('wrc-data-invalidate');
                ch.postMessage({ action: 'invalidate', ts: Date.now() });
                ch.close();
            } catch (_) {}

            this._setStatus('online');
            return true;
        } catch (error) {
            console.error('Błąd zapisu danych:', error);
            this._setStatus('offline');
            return false;
        } finally { this.isLoading = false; }
    }

    // ── Pomocnicze gettery (L1) ───────────────────────────────────────────────

    async getCurrentSeason() {
        const data = await this.loadData();
        if (!data) return null;
        return data.seasons[data.settings.currentSeason];
    }

    async getDrivers() {
        if (this._l1.drivers) return this._l1.drivers;
        const season = await this.getCurrentSeason();
        this._l1.drivers = season ? season.drivers : [];
        return this._l1.drivers;
    }

    async getTeams() {
        if (this._l1.teams) return this._l1.teams;
        const season = await this.getCurrentSeason();
        this._l1.teams = season ? season.teams : [];
        return this._l1.teams;
    }

    async getCalendar() {
        if (this._l1.calendar) return this._l1.calendar;
        const season = await this.getCurrentSeason();
        this._l1.calendar = season ? season.calendar : [];
        return this._l1.calendar;
    }

    async getRallyResults(rallyId) {
        const key = `rally_${rallyId}`;
        if (this._l1[key]) return this._l1[key];
        const season = await this.getCurrentSeason();
        this._l1[key] = season?.rallyResults?.[rallyId] || null;
        return this._l1[key];
    }

    async saveRallyResults(rallyId, results) {
        const data = await this.loadData();
        if (!data) return false;
        const season = data.seasons[data.settings.currentSeason];
        if (!season.rallyResults[rallyId])
            season.rallyResults[rallyId] = { stages: {}, extraPoints: {}, calculated: {} };
        season.rallyResults[rallyId] = results;
        delete this._l1[`rally_${rallyId}`];
        delete this._l1[`calc_${rallyId}`];
        delete this._l1.championship;
        delete this._l1.constructors;
        delete this._l1.powerStage;
        return await this.saveData(data);
    }

    // ── Sprawdzanie czy rajd jest anulowany ──────────────────────────────────
    _isRallyCancelled(rally) {
        return rally && rally.status === 'cancelled';
    }

    // ── Obliczenia wyników rajdu ──────────────────────────────────────────────

    async calculateRallyResults(rallyId) {
        const key = `calc_${rallyId}`;
        if (this._l1[key]) return this._l1[key];

        const season  = await this.getCurrentSeason();
        const rally   = season.calendar.find(r => r.id === rallyId);
        const results = await this.getRallyResults(rallyId);
        const drivers = await this.getDrivers();
        
        // Jeśli rajd jest anulowany – zwróć puste wyniki
        if (this._isRallyCancelled(rally)) {
            const emptyResults = {
                overall: drivers.map(d => ({
                    driverId: d.id,
                    driverName: d.name,
                    driverCountry: d.country,
                    teamId: d.teamId,
                    carModel: d.carModel || '',
                    totalTime: '—',
                    totalTimeSeconds: null,
                    totalBonus: 0,
                    stageTimes: [],
                    status: 'CANCELLED',
                    extraPoints: 0,
                    points: 0,
                    position: 0,
                    diff: '—'
                })),
                powerStage: [],
                cancelled: true
            };
            this._l1[key] = emptyResults;
            return emptyResults;
        }

        if (!rally || !results) return null;

        // Oblicz najgorszy czas na każdym OS (tylko dla statusu OK)
        const worstTimePerStage = {};
        for (const stage of rally.stages) {
            if (stage === rally.powerStage) continue;
            const stageData = results.stages[stage];
            if (!stageData || stageData.length === 0) { 
                worstTimePerStage[stage] = 9999; 
                continue; 
            }
            const times = stageData
                .filter(r => r.status === 'OK')
                .map(r => this.timeToSeconds(r.time))
                .filter(t => t !== Infinity && !isNaN(t));
            worstTimePerStage[stage] = times.length > 0 ? Math.max(...times) : 9999;
        }
        const hasAnyData = results.stages && Object.keys(results.stages).length > 0;

        const overallResults = [];
        for (const driver of drivers) {
            let totalTimeSeconds = 0;
            let finalStatus = 'OK';
            let hasDSQ = false;
            let hasAnyStageData = false;
            const stageTimes = [];

            // Dla każdego OS (poza Power Stage)
            for (const stage of rally.stages) {
                const isPowerStage = (stage === rally.powerStage);
                const stageResult = results.stages[stage]?.find(r => r.driverId === driver.id);
                const tc = stageResult?.tireChange === true;
                const worst = worstTimePerStage[stage] ?? 9999;

                if (!hasAnyData) {
                    stageTimes.push({ stage, time: '—', secs: Infinity, status: '—', isPowerStage, tireChange: false });
                    finalStatus = '—';
                    continue;
                }

                if (isPowerStage) {
                    if (!stageResult) {
                        stageTimes.push({ stage, time: '—', secs: Infinity, status: '—', isPowerStage, tireChange: false });
                    } else {
                        const psStatus = stageResult.status || 'OK';
                        const psSecs = psStatus === 'OK' ? this.timeToSeconds(stageResult.time) : Infinity;
                        stageTimes.push({ 
                            stage, 
                            time: psStatus === 'OK' ? stageResult.time : psStatus, 
                            secs: psSecs, 
                            status: psStatus, 
                            isPowerStage, 
                            tireChange: tc 
                        });
                    }
                    hasAnyStageData = true;
                    continue;
                }

                // OS (nie Power Stage)
                if (!stageResult) {
                    // DNS -> najgorszy + 45s
                    const penaltyTime = worst + 45;
                    totalTimeSeconds += penaltyTime;
                    finalStatus = 'DNS';
                    stageTimes.push({ 
                        stage, time: 'DNS', secs: penaltyTime, status: 'DNS', 
                        penaltyTime, isPowerStage, tireChange: false 
                    });
                    continue;
                }

                hasAnyStageData = true;
                const status = stageResult.status || 'OK';

                if (status === 'DSQ') {
                    hasDSQ = true;
                    finalStatus = 'DSQ';
                    stageTimes.push({ stage, time: 'DSQ', secs: Infinity, status: 'DSQ', isPowerStage, tireChange: false });
                    // Przerywamy – DSQ usuwa z klasyfikacji
                    totalTimeSeconds = Infinity;
                    break;
                } else if (status === 'RET' || status === 'DNS') {
                    // RET / DNS -> najgorszy + 45s
                    const penaltyTime = worst + 45;
                    totalTimeSeconds += penaltyTime;
                    if (status === 'RET') finalStatus = 'RET';
                    else finalStatus = 'DNS';
                    stageTimes.push({ 
                        stage, time: status, secs: penaltyTime, status: status, 
                        penaltyTime, isPowerStage, tireChange: false 
                    });
                } else if (status === 'DNF') {
                    // DNF -> najgorszy + 30s
                    const penaltyTime = worst + 30;
                    totalTimeSeconds += penaltyTime;
                    finalStatus = 'DNF';
                    stageTimes.push({ 
                        stage, time: 'DNF', secs: penaltyTime, status: 'DNF', 
                        penaltyTime, isPowerStage, tireChange: false 
                    });
                } else if (status === 'OK') {
                    const secs = this.timeToSeconds(stageResult.time);
                    if (secs === Infinity || isNaN(secs)) {
                        stageTimes.push({ 
                            stage, time: stageResult.time, secs: Infinity, 
                            status: 'INVALID', isPowerStage, tireChange: tc 
                        });
                    } else {
                        totalTimeSeconds += secs;
                        stageTimes.push({ 
                            stage, time: stageResult.time, secs, status: 'OK', 
                            isPowerStage, tireChange: tc 
                        });
                    }
                } else {
                    // Fallback – nieznany status traktuj jako DNF
                    const penaltyTime = worst + 30;
                    totalTimeSeconds += penaltyTime;
                    finalStatus = 'DNF';
                    stageTimes.push({ 
                        stage, time: status, secs: penaltyTime, status: 'DNF', 
                        penaltyTime, isPowerStage, tireChange: false 
                    });
                }
            }

            if (!hasAnyStageData && !hasAnyData) finalStatus = '—';
            if (hasDSQ) totalTimeSeconds = Infinity;

            // Bonusy (tylko jeśli nie DSQ)
            let totalBonus = 0;
            if (!hasDSQ && finalStatus !== '—') {
                totalBonus = rally.stages.reduce((sum, stage) => {
                    const sr = results.stages[stage]?.find(r => r.driverId === driver.id);
                    return sum + (sr?.bonus || 0);
                }, 0);
            }

            let displayStatus = finalStatus;
            if (hasDSQ) displayStatus = 'DSQ';
            if (!hasAnyData) displayStatus = '—';

            const hasValidTime = !hasDSQ && totalTimeSeconds !== Infinity && !isNaN(totalTimeSeconds);

            overallResults.push({
                driverId: driver.id,
                driverName: driver.name,
                driverCountry: driver.country,
                teamId: driver.teamId,
                carModel: driver.carModel || '',
                totalTime: hasValidTime ? this.secondsToTime(totalTimeSeconds) : '—',
                totalTimeSeconds: hasValidTime ? totalTimeSeconds : (hasDSQ ? Infinity : null),
                totalBonus,
                stageTimes,
                status: displayStatus,
                extraPoints: results.extraPoints?.[driver.id] || 0,
                points: 0
            });
        }

        // ===== SORTOWANIE =====
        // DSQ na końcu, reszta sortowana według czasu (z karami)
        overallResults.sort((a, b) => {
            // DSQ zawsze na końcu
            if (a.status === 'DSQ' && b.status !== 'DSQ') return 1;
            if (b.status === 'DSQ' && a.status !== 'DSQ') return -1;
            if (a.status === 'DSQ' && b.status === 'DSQ') return 0;

            // Jeśli brak danych – na koniec
            const aTime = a.totalTimeSeconds !== null ? a.totalTimeSeconds : Infinity;
            const bTime = b.totalTimeSeconds !== null ? b.totalTimeSeconds : Infinity;
            return aTime - bTime;
        });

        // Przypisz pozycje
        const pointsSystem = this.data?.settings?.pointsSystem || CONFIG.DEFAULTS.POINTS_SYSTEM;
        let currentPos = 1;
        let leaderTime = null;
        let prevTime = null;

        for (let i = 0; i < overallResults.length; i++) {
            const result = overallResults[i];

            // DSQ – brak pozycji, brak punktów
            if (result.status === 'DSQ' || result.status === '—' || result.status === 'CANCELLED') {
                result.position = null;
                result.points = 0;
                result.diff = '—';
                continue;
            }

            const time = result.totalTimeSeconds;
            if (time === null || time === Infinity) {
                result.position = null;
                result.points = 0;
                result.diff = '—';
                continue;
            }

            // Pierwszy poprawny czas = lider
            if (leaderTime === null) {
                leaderTime = time;
                currentPos = 1;
                result.position = 1;
                result.diff = '—';
            } else {
                // Jeśli czas taki sam jak poprzedni -> ex aequo
                if (Math.abs(time - prevTime) < 0.001) {
                    result.position = currentPos;
                } else {
                    currentPos = i + 1;
                    result.position = currentPos;
                }
                result.diff = this.secondsToDiff(time - leaderTime);
            }

            result.points = (pointsSystem[result.position - 1] || 0);
            if (result.position === null) result.points = 0;
            prevTime = time;
        }

        // Power Stage – osobno
        const powerStageResults = [];
        const powerStage = results.stages[rally.powerStage];
        const psPoints = this.data?.settings?.powerStagePoints || CONFIG.DEFAULTS.POWER_STAGE_POINTS;

        if (powerStage && hasAnyData) {
            const valid = powerStage.filter(r => r.status === 'OK');
            valid.sort((a, b) => this.timeToSeconds(a.time) - this.timeToSeconds(b.time));

            valid.forEach((result, index) => {
                if (index < psPoints.length) {
                    const driver = drivers.find(d => d.id === result.driverId);
                    powerStageResults.push({
                        driverId: result.driverId,
                        driverName: driver?.name,
                        driverCountry: driver?.country,
                        time: result.time,
                        position: index + 1,
                        points: psPoints[index]
                    });
                }
            });
        }

        // Zapisz w cache
        results.calculated = { overall: overallResults, powerStage: powerStageResults };
        this._l1[key] = results.calculated;
        return results.calculated;
    }

    // ── Obliczenia zbiorcze: jedno wywołanie zamiast trzech osobnych ──────────
    //
    // Użycie na index.html:
    //   const { championship, constructors, powerStage } = await api.calculateAllStandings();
    //
    // Korzyść: wyniki wszystkich rajdów liczone JEDEN RAZ i współdzielone
    // między championship / constructors / powerStage.

    async calculateAllStandings() {
        if (this._l1.championship && this._l1.constructors && this._l1.powerStage) {
            return {
                championship: this._l1.championship,
                constructors: this._l1.constructors,
                powerStage:   this._l1.powerStage
            };
        }

        // Pobierz dane równolegle
        const [drivers, teams, calendar] = await Promise.all([
            this.getDrivers(),
            this.getTeams(),
            this.getCalendar()
        ]);

        // Przelicz wyniki wszystkich NIEANULOWANYCH ukończonych rajdów równolegle
        const completedRallies = calendar.filter(r => r.status === 'completed');
        await Promise.all(completedRallies.map(r => this.calculateRallyResults(r.id)));

        // Anulowane rajdy też mają puste wyniki (dla spójności)
        const cancelledRallies = calendar.filter(r => r.status === 'cancelled');
        await Promise.all(cancelledRallies.map(r => this.calculateRallyResults(r.id)));

        // Teraz wszystkie calc_* są w L1 – obliczenia zbiorcze nie robią fetch
        const [championship, constructors, powerStage] = await Promise.all([
            this._computeChampionship(drivers, calendar),
            this._computeConstructors(teams, drivers, calendar),
            this._computePowerStage(drivers, calendar)
        ]);

        this._l1.championship = championship;
        this._l1.constructors = constructors;
        this._l1.powerStage   = powerStage;
        this._persistCalcToStorage();

        return { championship, constructors, powerStage };
    }

    async calculateChampionship() {
        if (this._l1.championship) return this._l1.championship;
        const [drivers, calendar] = await Promise.all([this.getDrivers(), this.getCalendar()]);
        const completedRallies = calendar.filter(r => r.status === 'completed');
        await Promise.all(completedRallies.map(r => this.calculateRallyResults(r.id)));
        this._l1.championship = await this._computeChampionship(drivers, calendar);
        this._persistCalcToStorage();
        return this._l1.championship;
    }

    async calculateConstructors() {
        if (this._l1.constructors) return this._l1.constructors;
        const [teams, drivers, calendar] = await Promise.all([this.getTeams(), this.getDrivers(), this.getCalendar()]);
        const completedRallies = calendar.filter(r => r.status === 'completed');
        await Promise.all(completedRallies.map(r => this.calculateRallyResults(r.id)));
        this._l1.constructors = await this._computeConstructors(teams, drivers, calendar);
        this._persistCalcToStorage();
        return this._l1.constructors;
    }

    async calculatePowerStageChampionship() {
        if (this._l1.powerStage) return this._l1.powerStage;
        const [drivers, calendar] = await Promise.all([this.getDrivers(), this.getCalendar()]);
        const completedRallies = calendar.filter(r => r.status === 'completed');
        await Promise.all(completedRallies.map(r => this.calculateRallyResults(r.id)));
        this._l1.powerStage = await this._computePowerStage(drivers, calendar);
        this._persistCalcToStorage();
        return this._l1.powerStage;
    }

    // ── Wewnętrzne implementacje (synchroniczne po przeliczeniu rajdów) ───────

    async _computeChampionship(drivers, calendar) {
        const standings = [];
        for (const driver of drivers) {
            let totalPoints = 0;
            const rallyDetails = [];
            for (const rally of calendar) {
                let rPts = 0;
                const rb = { rallyId: rally.id, rallyName: rally.name, points: 0, details: [] };
                
                // POMIŃ ANULOWANE RAJDY - nie przyznawaj punktów
                if (rally.status === 'cancelled') {
                    rallyDetails.push(rb);
                    continue;
                }
                
                if (rally.status === 'completed') {
                    const calc = this._l1[`calc_${rally.id}`];
                    if (calc?.overall) {
                        const dr = calc.overall.find(r => r.driverId === driver.id);
                        if (dr && dr.status !== '—' && dr.status !== 'CANCELLED' && dr.status !== 'DSQ') {
                            if (dr.points > 0) { 
                                rPts += dr.points; 
                                rb.details.push({ type: 'Position', points: dr.points }); 
                            }
                            const ps = calc.powerStage?.find(r => r.driverId === driver.id);
                            if (ps) { rPts += ps.points; rb.details.push({ type: 'Power Stage', points: ps.points }); }
                            if (dr.totalBonus > 0)  { rPts += dr.totalBonus;  rb.details.push({ type: 'Bonus', points: dr.totalBonus }); }
                            if (dr.extraPoints > 0) { rPts += dr.extraPoints; rb.details.push({ type: 'Extra', points: dr.extraPoints }); }
                            totalPoints += rPts; rb.points = rPts;
                        }
                    }
                }
                rallyDetails.push(rb);
            }
            standings.push({ driverId: driver.id, driverName: driver.name, driverCountry: driver.country, teamId: driver.teamId, carModel: driver.carModel || '', totalPoints, rallyDetails });
        }
        standings.sort((a, b) => b.totalPoints - a.totalPoints);
        standings.forEach((s, i) => { s.position = i + 1; s.diff = i > 0 ? standings[0].totalPoints - s.totalPoints : 0; });
        return standings;
    }

    async _computeConstructors(teams, drivers, calendar) {
        const teamPointsCount = this.data?.settings?.teamPointsCount || CONFIG.DEFAULTS.TEAM_POINTS_COUNT;
        const standings = [];
        for (const team of teams) {
            let totalPoints = 0;
            const rallyDetails = [];
            const teamDrivers  = drivers.filter(d => d.teamId === team.id);
            for (const rally of calendar) {
                let rPts = 0;
                const driverPoints = [];
                
                // POMIŃ ANULOWANE RAJDY
                if (rally.status === 'cancelled') {
                    rallyDetails.push({ rallyId: rally.id, rallyName: rally.name, points: 0, driverPoints: [] });
                    continue;
                }
                
                if (rally.status === 'completed') {
                    const calc = this._l1[`calc_${rally.id}`];
                    if (calc?.overall) {
                        for (const driver of teamDrivers) {
                            const dr = calc.overall.find(r => r.driverId === driver.id);
                            if (dr && dr.status !== '—' && dr.status !== 'CANCELLED' && dr.status !== 'DSQ') {
                                let pts = dr.points || 0;
                                const ps = calc.powerStage?.find(r => r.driverId === driver.id);
                                if (ps) pts += ps.points;
                                pts += (dr.totalBonus || 0) + (dr.extraPoints || 0);
                                if (pts > 0) driverPoints.push({ driverName: driver.name, points: pts });
                            }
                        }
                    }
                }
                driverPoints.sort((a, b) => b.points - a.points);
                const top = driverPoints.slice(0, teamPointsCount);
                rPts = top.reduce((s, dp) => s + dp.points, 0);
                totalPoints += rPts;
                rallyDetails.push({ rallyId: rally.id, rallyName: rally.name, points: rPts, driverPoints: top });
            }
            standings.push({ teamId: team.id, teamName: team.name, teamLogo: team.logo || 'assets/teams/default.png', totalPoints, rallyDetails });
        }
        standings.sort((a, b) => b.totalPoints - a.totalPoints);
        standings.forEach((s, i) => { s.position = i + 1; s.diff = i > 0 ? standings[0].totalPoints - s.totalPoints : 0; });
        return standings;
    }

    async _computePowerStage(drivers, calendar) {
        const standings = [];
        for (const driver of drivers) {
            let totalPoints = 0;
            const rallyPoints = {};
            for (const rally of calendar) {
                // POMIŃ ANULOWANE RAJDY
                if (rally.status === 'cancelled') {
                    rallyPoints[rally.id] = 0;
                    continue;
                }
                
                if (rally.status === 'completed') {
                    const calc = this._l1[`calc_${rally.id}`];
                    const ps = calc?.powerStage?.find(r => r.driverId === driver.id);
                    if (ps) { totalPoints += ps.points; rallyPoints[rally.id] = ps.points; }
                }
                if (!rallyPoints[rally.id]) rallyPoints[rally.id] = 0;
            }
            standings.push({ driverId: driver.id, driverName: driver.name, driverCountry: driver.country, teamId: driver.teamId, carModel: driver.carModel || '', totalPoints, rallyPoints });
        }
        standings.sort((a, b) => b.totalPoints - a.totalPoints);
        standings.forEach((s, i) => { s.position = i + 1; s.diff = i > 0 ? standings[0].totalPoints - s.totalPoints : 0; });
        return standings;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    async checkAdminPassword(password) {
        const data = await this.loadData();
        return data?.settings?.adminPassword === password;
    }

    async updateSettings(settings) {
        const data = await this.loadData();
        if (!data) return false;
        data.settings = { ...data.settings, ...settings };
        return await this.saveData(data);
    }

    // ── Konwersja czasu ───────────────────────────────────────────────────────

    timeToSeconds(time) {
        if (!time || time === '—' || time === 'DNS' || time === 'DNF' || time === 'RET' || time === 'DSQ') return Infinity;
        const m = time.match(/^(\d+):(\d+)\.(\d+)$/);
        if (m) return parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / 1000;
        const f = parseFloat(time);
        return isNaN(f) ? Infinity : f;
    }

    secondsToTime(s) {
        if (s === Infinity || isNaN(s) || s === null) return '—';
        const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 1000);
        return `${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`;
    }

    secondsToDiff(s) {
        if (s === Infinity || isNaN(s) || s === 0) return '—';
        const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 1000);
        return `+${m}:${sec.toString().padStart(2,'0')}.${ms.toString().padStart(3,'0')}`;
    }

    // ── Import / Export ───────────────────────────────────────────────────────

    async exportAllData() {
        const data = await this.loadData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `wrc_backup_${new Date().toISOString()}.json`; a.click();
        URL.revokeObjectURL(url);
    }

    async importAllData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const importData = JSON.parse(e.target.result);
                    const saved = await this.saveData(importData);
                    if (saved) resolve(true); else reject('Błąd zapisu');
                } catch { reject('Nieprawidłowy plik'); }
            };
            reader.onerror = () => reject('Błąd odczytu pliku');
            reader.readAsText(file);
        });
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
const api = new WRCAPI();

// ── Unieważnienie cache z innych zakładek (po zapisie admin) ─────────────────
try {
    const _ch = new BroadcastChannel('wrc-data-invalidate');
    _ch.onmessage = (e) => {
        if (e.data?.action === 'invalidate') {
            api._invalidateStorage();
            api.data    = null;
            api._l1     = {};
            api._l1Time = 0;
            api._etag   = null;
        }
    };
} catch (_) {}

// ── Wskaźnik statusu JSONBin ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
        .rallytv-btn {
            display: inline-flex !important; align-items: center;
            gap: 6px; padding: 0 14px 0 10px !important;
            transition: background 0.35s, color 0.35s;
        }
        .rallytv-btn::before {
            content: ''; display: block; width: 7px; height: 7px;
            border-radius: 50%; background: rgba(255,255,255,0.4);
            flex-shrink: 0; transition: background 0.35s, box-shadow 0.35s;
        }
        .rallytv-btn[data-status="online"]  { background: #166534 !important; color: #bbf7d0 !important; }
        .rallytv-btn[data-status="online"]::before  { background: #4ade80; box-shadow: 0 0 0 2px rgba(74,222,128,.35); animation: rtv-pulse 2.4s ease-in-out infinite; }
        .rallytv-btn[data-status="offline"] { background: #7f1d1d !important; color: #fecaca !important; }
        .rallytv-btn[data-status="offline"]::before { background: #f87171; box-shadow: 0 0 0 2px rgba(248,113,113,.3); }
        .rallytv-btn[data-status="loading"] { background: #374151 !important; color: #d1d5db !important; }
        .rallytv-btn[data-status="loading"]::before { background: #9ca3af; animation: rtv-pulse 1s ease-in-out infinite; }
        .rallytv-status-label { font-size: 12px; font-weight: 500; letter-spacing: .02em; line-height: 1; }
        @keyframes rtv-pulse {
            0%,100% { box-shadow: 0 0 0 2px rgba(74,222,128,.35); }
            50%      { box-shadow: 0 0 0 5px rgba(74,222,128,.08); }
        }
    `;
    document.head.appendChild(style);

    document.querySelectorAll('.rallytv-btn').forEach(btn => {
        btn.textContent = '';
        const label = document.createElement('span');
        label.className  = 'rallytv-status-label';
        label.textContent = api.data ? 'Online' : 'Łączenie…';
        btn.appendChild(label);
        btn.setAttribute('data-status', api.data ? 'online' : 'loading');
    });

    api.onStatusChange(status => {
        const msgs = { online: 'Online', offline: 'Offline', unknown: 'Łączenie…', loading: 'Łączenie…' };
        document.querySelectorAll('.rallytv-btn').forEach(btn => {
            btn.setAttribute('data-status', status);
            const lbl = btn.querySelector('.rallytv-status-label');
            if (lbl) lbl.textContent = msgs[status] || 'Łączenie…';
        });
    });

    api.startStatusPolling();
});