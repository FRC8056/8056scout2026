document.addEventListener('alpine:init', () => {
    Alpine.data('matchesApp', () => ({
        frcMatches: [],
        scoutEntries: {},
        availableSeasons: FRC_CONFIG.seasons,
        availableEvents: FRC_CONFIG.events,
        selectedSeasons: [...FRC_CONFIG.seasons],
        selectedEvents: FRC_CONFIG.events.filter(e => e.season === 2026).map(e => e.key),
        selectedTypes: ['Qualification'],
        searchQuery: '',
        loading: true,
        errorMessage: '',
        expandedMatches: [],
        expandedReports: [],
        teamDataCache: {},
        manualTeams: {},

        async init() {
            try {
                this.manualTeams = await loadManualTeams();

                // Handle URL params like ?team=8056
                const params = new URLSearchParams(window.location.search);
                if (params.has('team')) {
                    this.searchQuery = params.get('team');
                    // Ensure the year/event might need to be adjusted if matching a specific team, 
                    // but for now just setting search query is safest for the user to see results.
                }

                this.$watch('selectedEvents', () => {
                    this.fetchMatches();
                });


                await this.fetchMatches();

                db.collection('scouting').onSnapshot(snapshot => {
                    this.scoutEntries = {};
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        data.id = doc.id; // Store Firestore ID
                        if (data.matchNumber) {
                            // Support both old flat format (data.matchType or data.data.matchType) and new meta format
                            const matchType = data.meta?.matchType || data.data?.matchType || data.matchType || 'Qualification';
                            const key = `${data.regional}_${matchType}_${data.matchNumber}`;
                            if (!this.scoutEntries[key]) this.scoutEntries[key] = [];
                            this.scoutEntries[key].push(data);
                        }
                    });

                    // Sort entries for each match by date (newest first)
                    Object.keys(this.scoutEntries).forEach(key => {
                        this.scoutEntries[key].sort((a, b) => {
                            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                            return dateB - dateA;
                        });
                    });
                    this.loading = false;
                }, err => {
                    this.errorMessage = 'Firestore connection failed';
                    this.loading = false;
                });
            } catch (err) {
                console.error("Init Error:", err);
                this.errorMessage = 'Failed to initialize matches: ' + err.message;
                this.loading = false;
            }
        },

        async fetchMatches() {
            this.loading = true;
            this.errorMessage = '';
            try {
                // Fetch matches for all selected events
                const allMatches = await Promise.all(
                    this.selectedEvents.map(key => fetchFRCMatches(key))
                );
                // Flatten and add event key to each match for filtering
                this.frcMatches = allMatches.flatMap((matches, i) =>
                    matches.map(m => ({ ...m, eventKey: this.selectedEvents[i] }))
                );

                // Fetch and cache team names for all teams in these matches
                this.selectedEvents.forEach(async eventKey => {
                    const url = `https://www.thebluealliance.com/api/v3/event/${eventKey}/teams`;
                    const res = await fetch(url, { headers: { "X-TBA-Auth-Key": FRC_CONFIG.apiKey } });
                    if (res.ok) {
                        const teams = await res.json();
                        teams.forEach(t => {
                            this.teamDataCache[t.team_number] = {
                                nickname: t.nickname || t.name,
                                city: t.city
                            };
                        });
                    }
                });

                this.frcMatches.sort((a, b) => {
                    const weights = { 'p': 0, 'qm': 1, 'qf': 2, 'sf': 3, 'f': 4 };
                    const wA = weights[a.compLevel] || 1;
                    const wB = weights[b.compLevel] || 1;
                    if (wA !== wB) return wA - wB;
                    return a.matchNumber - b.matchNumber;
                });
            } catch (e) {
                console.error("Error fetching matches:", e);
                this.errorMessage = 'Failed to fetch matches updates from API';
            } finally {
                this.loading = false;
            }
        },

        toggleMatch(key) {
            if (this.expandedMatches.includes(key)) {
                this.expandedMatches = this.expandedMatches.filter(k => k !== key);
            } else {
                this.expandedMatches.push(key);
            }
        },

        toggleReport(id) {
            if (this.expandedReports.includes(id)) {
                this.expandedReports = this.expandedReports.filter(i => i !== id);
            } else {
                this.expandedReports.push(id);
                this.loadScouterTeamData(id);
            }
        },

        filteredMatches() {
            const scoutedKeys = Object.keys(this.scoutEntries);

            let list = this.frcMatches.map(m => {
                const type = m.compLevel === 'qm' ? 'Qualification' :
                    m.compLevel === 'p' ? 'Practice' : 'Playoffs';
                const eventShort = this.availableEvents.find(e => e.key === m.eventKey)?.name.split(' ')[0] || m.eventKey;
                const year = this.availableEvents.find(e => e.key === m.eventKey)?.season || '';

                return {
                    ...m,
                    type,
                    eventShort,
                    year,
                    isManual: false
                };
            });

            scoutedKeys.forEach(key => {
                const [regional, scoutType, matchNumStr] = key.split('_');
                const matchNum = Number(matchNumStr);

                // Map frontend scouted Type back to TBA compLevel
                let scoutCompLevel = 'qm';
                if (scoutType === 'Practice') scoutCompLevel = 'p';
                if (scoutType === 'Playoffs') scoutCompLevel = 'sf';

                // Look for an existing API match that is strictly matching BOTH event + matchNumber AND match type!
                const existingApiMatchListIndex = list.findIndex(m =>
                    m.eventKey === regional &&
                    m.matchNumber === matchNum &&
                    (
                        (scoutType === 'Practice' && m.compLevel === 'p') ||
                        (scoutType === 'Qualification' && m.compLevel === 'qm') ||
                        (scoutType === 'Playoffs' && ['qf', 'sf', 'f'].includes(m.compLevel))
                    )
                );

                const entries = this.scoutEntries[key];

                if (existingApiMatchListIndex === -1) {
                    const eventObj = this.availableEvents.find(e => e.key === regional);

                    list.push({
                        matchNumber: matchNum,
                        eventKey: regional,
                        eventShort: eventObj?.name.split(' ')[0] || regional,
                        year: eventObj?.season || '',
                        type: scoutType,
                        description: `${scoutType} ${matchNum}`,
                        compLevel: scoutCompLevel,
                        teams: [],
                        isManual: true,
                        scoutedTeams: entries.map(e => e.teamNumber)
                    });
                } else {
                    // Update type of existing match if it only exists in scout data with different type assumption
                    const mInfo = list[existingApiMatchListIndex];
                    if (mInfo && mInfo.isManual) {
                        mInfo.type = scoutType;
                    }
                }
            });
            // Sort logic: Newest year first, then Playoffs > Quals > Practice, then matchNumber DESC
            const levelWeight = { 'f': 5, 'sf': 4, 'qf': 3, 'qm': 2, 'p': 1 };

            list.sort((a, b) => {
                const yearB = parseInt(b.year) || 0;
                const yearA = parseInt(a.year) || 0;
                if (yearB !== yearA) return yearB - yearA;

                const weightA = levelWeight[a.compLevel] || 0;
                const weightB = levelWeight[b.compLevel] || 0;
                if (weightB !== weightA) return weightB - weightA;

                return b.matchNumber - a.matchNumber;
            });

            return list.filter(m => {
                // Event Filter
                if (this.selectedEvents.length > 0 && !this.selectedEvents.includes(m.eventKey)) return false;

                // Type Filter
                const isPractice = m.compLevel === 'p' || m.type === 'Practice';
                const isQual = m.compLevel === 'qm' || m.type === 'Qualification';
                const isPlayoff = ['qf', 'sf', 'f'].includes(m.compLevel) || m.type === 'Playoffs';

                let typeMatch = false;
                if (this.selectedTypes.includes('Practice') && isPractice) typeMatch = true;
                if (this.selectedTypes.includes('Qualification') && isQual) typeMatch = true;
                if (this.selectedTypes.includes('Playoffs') && isPlayoff) typeMatch = true;

                if (!typeMatch) return false;

                // Search Query Filter
                if (this.searchQuery) {
                    const matchNumMatch = m.matchNumber.toString() === this.searchQuery;
                    const teamMatch = m.teams?.some(t => t.teamNumber.toString().includes(this.searchQuery)) ||
                        m.scoutedTeams?.some(t => t.toString().includes(this.searchQuery));
                    if (!matchNumMatch && !teamMatch) return false;
                }
                return true;
            }).sort((a, b) => {
                if (b.year !== a.year) return b.year - a.year;
                const weights = { 'p': 0, 'qm': 1, 'qf': 2, 'sf': 3, 'f': 4 };
                const wA = weights[a.compLevel] || 1;
                const wB = weights[b.compLevel] || 1;
                if (wA !== wB) return wA - wB;
                return a.matchNumber - b.matchNumber;
            });
        },

        isHighlighted(teamNumber) {
            if (!this.searchQuery) return false;
            return teamNumber.toString().includes(this.searchQuery);
        },

        getTeamData(teamNumber) {
            if (!teamNumber) return { nickname: '', logoUrl: '' };

            // Check manual teams first
            if (this.manualTeams[teamNumber]) {
                const mt = this.manualTeams[teamNumber];
                return {
                    nickname: mt.name || '',
                    logoUrl: mt.logo || ''
                };
            }

            // Check cache
            if (this.teamDataCache[teamNumber]) {
                return {
                    nickname: this.teamDataCache[teamNumber].nickname || '',
                    logoUrl: '' // Logo fetching is more expensive, using nickname for now
                };
            }

            return { nickname: '', logoUrl: '' };
        },

        getScoringRules(year) {
            return FRC_CONFIG.scoring[year] || FRC_CONFIG.scoring[FRC_CONFIG.defaultSeason];
        },

        // Parses "5-10" or "10" into a numeric average or value
        parseFuel(val) {
            if (!val) return 0;
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
                if (val.includes('-')) {
                    const parts = val.split('-').map(p => parseInt(p));
                    return (parts[0] + parts[1]) / 2; // Use average for score estimation
                }
                return parseInt(val) || 0;
            }
            return 0;
        },

        calculateScores(entry, year) {
            if (!entry) return { auto: 0, teleop: 0, endgame: 0, totalFuel: 0, total: 0 };

            // Improved Score Estimation logic for 2026
            const parseRange = (val) => {
                if (!val || val === '0') return 0;
                if (typeof val === 'string' && val.includes('-')) {
                    const p = val.split('-').map(Number);
                    return (p[0] + p[1]) / 2;
                }
                return Number(val) || 0;
            };

            // Auto
            let autoPoints = 0;
            autoPoints += parseRange(entry.auto?.scored) * 4;
            if (entry.auto?.level1 === 'success') autoPoints += 3;

            // Teleop & Transition
            let teleopPoints = 0;
            teleopPoints += parseRange(entry.transitionShift) * 2;
            teleopPoints += parseRange(entry.teleopShiftA) * 3;
            teleopPoints += parseRange(entry.teleopShiftB) * 4;

            // Endgame Shift
            let endgameShiftPoints = 0;
            endgameShiftPoints += parseRange(entry.endgameShift) * 5;

            // Climb
            let climbPoints = 0;
            const level = entry.endgame?.level?.toLowerCase();
            if (level === 'park') climbPoints = 2;
            else if (level === 'shallow') climbPoints = 6;
            else if (level === 'deep') climbPoints = 12;

            return {
                auto: autoPoints,
                teleop: teleopPoints,
                endgame: climbPoints + endgameShiftPoints,
                total: autoPoints + teleopPoints + endgameShiftPoints + climbPoints,
                details: {
                    autoFailed: entry.auto?.failed || '0',
                    shooterSpeed: entry.ratings?.shooterSpeed || 3,
                    endgameShift: entry.endgameShift || '0'
                }
            };
        },

        isVerified(role) {
            return role && role !== 'new';
        },

        formatDate(timestamp) {
            if (!timestamp) return 'N/A';
            // Handle Firestore Timestamp vs Date
            const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return date.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        },

        async loadScouterTeamData(id) {
            // Optional: Fetch team logo/name for scouter team if needed
        }
    }));
});
