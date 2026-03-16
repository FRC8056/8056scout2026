document.addEventListener('alpine:init', () => {
    Alpine.data('teamsApp', () => ({
        teams: [],
        pitReports: {},
        expandedTeams: [],
        expandedHistory: [],
        expandedPitReports: [],
        availableSeasons: FRC_CONFIG.seasons,
        availableEvents: FRC_CONFIG.events,
        selectedSeasons: [...FRC_CONFIG.seasons],
        selectedEvents: FRC_CONFIG.events.filter(e => e.season === 2026).map(e => e.key),
        searchQuery: '',
        loading: true,
        mergeMode: false,
        teamEventMatrix: {}, // Tracks which team is in which selected event

        async init() {
            // Check for team search in URL
            const urlParams = new URLSearchParams(window.location.search);
            const teamFilter = urlParams.get('team');
            if (teamFilter) {
                this.searchQuery = teamFilter;
            }

            this.loading = true;

            // Instant refresh on selection changes
            this.$watch('selectedEvents', () => this.fetchEventTeams());

            await this.fetchEventTeams();

            // 3. Fetch Pit Reports from Firestore
            db.collection('pitScouting').onSnapshot(snapshot => {
                this.pitReports = {};
                snapshot.forEach(doc => {
                    const data = doc.data();
                    data.id = doc.id;
                    if (!this.pitReports[data.teamNumber]) {
                        this.pitReports[data.teamNumber] = [];
                    }
                    this.pitReports[data.teamNumber].push(data);
                });

                // Sort each team's reports by date (newest first)
                Object.keys(this.pitReports).forEach(teamNum => {
                    this.pitReports[teamNum].sort((a, b) => {
                        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                        return dateB - dateA;
                    });
                });
            });

            this.loading = false;
        },

        async fetchEventTeams() {
            this.loading = true;
            this.teamEventMatrix = {};
            const teamMap = new Map();

            try {
                // 1. Get events from config
                const filteredEvents = FRC_CONFIG.events.filter(e =>
                    this.selectedSeasons.includes(e.season) &&
                    this.selectedEvents.includes(e.key)
                );

                // 2. Fetch teams from selected events
                for (const event of filteredEvents) {
                    const eventTeams = await this.fetchTBARequest(`event/${event.key}/teams`);
                    eventTeams.forEach(t => {
                        const teamNum = t.team_number;
                        if (!teamMap.has(teamNum)) {
                            teamMap.set(teamNum, {
                                teamNumber: teamNum,
                                name: t.nickname || t.name,
                                city: t.city || 'Unknown',
                                country: t.country || 'Turkey',
                                awards: [],
                                events: [],
                                logoUrl: null
                            });
                        }
                        if (!this.teamEventMatrix[teamNum]) this.teamEventMatrix[teamNum] = [];
                        if (!this.teamEventMatrix[teamNum].includes(event.key)) {
                            this.teamEventMatrix[teamNum].push(event.key);
                        }
                    });
                }

                this.teams = Array.from(teamMap.values()).sort((a, b) => a.teamNumber - b.teamNumber);
                this.loading = false;
            } catch (err) {
                console.error("Failed to load teams:", err);
                this.loading = false;
            }
        },

        async fetchTBARequest(endpoint) {
            const url = `https://www.thebluealliance.com/api/v3/${endpoint}`;
            const res = await fetch(url, {
                headers: { "X-TBA-Auth-Key": FRC_CONFIG.apiKey }
            });
            return res.ok ? await res.json() : [];
        },

        async toggleTeam(teamNumber) {
            if (this.expandedTeams.includes(teamNumber)) {
                this.expandedTeams = this.expandedTeams.filter(t => t !== teamNumber);
            } else {
                this.expandedTeams.push(teamNumber);
                // Load deep data if not already loaded
                const team = this.teams.find(t => t.teamNumber === teamNumber);
                if (team && (!team.awards.length || !team.events.length)) {
                    await this.loadTeamDetail(team);
                }
            }
        },

        async loadTeamDetail(team) {
            team.loadingDetails = true;
            try {
                // 1. Fetch Basic Info Media (Logo)
                const media = await this.fetchTBARequest(`team/frc${team.teamNumber}/media/2025`);
                const logo = media.find(m => m.type === 'avatar' || m.type === 'image');
                if (logo) {
                    team.logoUrl = logo.direct_url || (logo.details?.base64_avatar ? `data:image/png;base64,${logo.details.base64_avatar}` : null);
                }

                // 2. Load Awards
                const allAwards = await this.fetchTBARequest(`team/frc${team.teamNumber}/awards`);
                for (const award of allAwards) {
                    const event = FRC_CONFIG.events.find(e => e.key === award.event_key);
                    award.event_name = event ? event.name : await this.getEventName(award.event_key);
                }
                team.awards = allAwards.slice(0, 10);

                // 3. Load Events (2025-2026)
                const years = [2025, 2026];
                const allTeamEvents = [];
                for (const yr of years) {
                    const yrEvents = await this.fetchTBARequest(`team/frc${team.teamNumber}/events/${yr}`);
                    allTeamEvents.push(...yrEvents);
                }
                team.events = allTeamEvents.sort((a, b) => b.year - a.year || b.start_date.localeCompare(a.start_date));
            } catch (e) {
                console.error("Detail load failed for " + team.teamNumber, e);
            } finally {
                team.loadingDetails = false;
            }
        },

        eventCache: {},
        async getEventName(eventKey) {
            if (this.eventCache[eventKey]) return this.eventCache[eventKey];
            const data = await this.fetchTBARequest(`event/${eventKey}`);
            if (data && data.name) {
                this.eventCache[eventKey] = data.name;
                return data.name;
            }
            return eventKey;
        },

        toggleHistory(teamNumber) {
            if (this.expandedHistory.includes(teamNumber)) {
                this.expandedHistory = this.expandedHistory.filter(t => t !== teamNumber);
            } else {
                this.expandedHistory.push(teamNumber);
            }
        },

        togglePitReport(id) {
            if (this.expandedPitReports.includes(id)) {
                this.expandedPitReports = this.expandedPitReports.filter(i => i !== id);
            } else {
                this.expandedPitReports.push(id);
            }
        },

        get filteredTeams() {
            let list = this.teams;

            // 1. Logic intersection vs union
            if (this.selectedEvents.length > 0) {
                if (this.mergeMode) {
                    // INTERSECTION: Only teams in ALL selected regionals
                    list = list.filter(t =>
                        this.selectedEvents.every(key => this.teamEventMatrix[t.teamNumber]?.includes(key))
                    );
                } else {
                    // UNION: Teams in ANY selected regional
                    list = list.filter(t =>
                        t.eventKeys?.some(key => this.selectedEvents.includes(key)) ||
                        this.teamEventMatrix[t.teamNumber]?.some(key => this.selectedEvents.includes(key))
                    );
                }
            }

            // 2. Search Query Filter
            if (this.searchQuery) {
                const q = this.searchQuery.toLowerCase();
                list = list.filter(t =>
                    t.teamNumber.toString().includes(q) ||
                    t.name.toLowerCase().includes(q)
                );
            }

            return list;
        },

        isVerified(role) {
            return role && role !== 'new';
        },

        formatDate(timestamp) {
            if (!timestamp) return 'N/A';
            const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return date.toLocaleString();
        },

        getTeamData(teamNumber) {
            if (!teamNumber) return { nickname: '' };
            const team = this.teams.find(t => t.teamNumber === teamNumber);
            return {
                nickname: team ? team.name : ''
            };
        },
        async deletePitReport(id) {
            if (!confirm("Are you sure you want to delete this pit report? This action cannot be undone.")) return;
            try {
                await db.collection('pitScouting').doc(id).delete();
            } catch (err) {
                console.error("Delete failed:", err);
                alert("Failed to delete pit report: " + err.message);
            }
        }
    }));
});
