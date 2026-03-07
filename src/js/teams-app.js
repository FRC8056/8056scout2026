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
        selectedEvents: FRC_CONFIG.events.map(e => e.key),
        searchQuery: '',
        loading: true,

        async init() {
            // Check for team search in URL
            const urlParams = new URLSearchParams(window.location.search);
            const teamFilter = urlParams.get('team');
            if (teamFilter) {
                this.searchQuery = teamFilter;
            }

            this.loading = true;
            try {
                // 1. Get events from config
                const filteredEvents = FRC_CONFIG.events.filter(e =>
                    this.selectedSeasons.includes(e.season) &&
                    this.selectedEvents.includes(e.key)
                );

                // 2. Fetch teams from selected events
                const teamMap = new Map();
                for (const event of filteredEvents) {
                    const eventTeams = await this.fetchEventTeams(event.key);
                    eventTeams.forEach(t => {
                        if (!teamMap.has(t.team_number)) {
                            teamMap.set(t.team_number, {
                                ...t,
                                eventKeys: [event.key]
                            });
                        } else {
                            const existing = teamMap.get(t.team_number);
                            if (!existing.eventKeys.includes(event.key)) {
                                existing.eventKeys.push(event.key);
                            }
                        }
                    });
                }

                this.teams = Array.from(teamMap.values()).map(t => ({
                    teamNumber: t.team_number,
                    name: t.nickname || t.name,
                    city: t.city || 'Unknown',
                    country: t.country || 'Turkey',
                    awards: [],
                    events: [],
                    eventKeys: t.eventKeys || []
                })).sort((a, b) => a.teamNumber - b.teamNumber);

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
            } catch (err) {
                console.error("Failed to load teams:", err);
                this.loading = false;
            }
        },

        async fetchEventTeams(eventKey) {
            const url = `https://www.thebluealliance.com/api/v3/event/${eventKey}/teams`;
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
            try {
                // 1. Fetch Basic Info (Name/City) and Media (Logo)
                const info = await fetchFRCTeamInfo(team.teamNumber);
                if (info) {
                    team.name = info.nickname || info.name;
                    team.city = info.city || team.city;
                }

                const media = await fetchFRCTeamMedia(team.teamNumber, 2025);
                const logo = media.find(m => m.type === 'avatar' || m.type === 'image');
                if (logo) {
                    team.logoUrl = logo.direct_url || (logo.details?.base64_avatar ? `data:image/png;base64,${logo.details.base64_avatar}` : null);
                }

                // 2. Load Awards (global history)
                const awardsUrl = `https://www.thebluealliance.com/api/v3/team/frc${team.teamNumber}/awards`;
                const awardsRes = await fetch(awardsUrl, { headers: { "X-TBA-Auth-Key": FRC_CONFIG.apiKey } });
                if (awardsRes.ok) {
                    const allAwards = await awardsRes.json();
                    // Map event keys to names
                    for (const award of allAwards) {
                        const event = FRC_CONFIG.events.find(e => e.key === award.event_key);
                        award.event_name = event ? event.name : await this.getEventName(award.event_key);
                    }
                    team.awards = allAwards.slice(0, 10);
                }

                // 3. Load Events for 2020-2026
                const startYear = 2020;
                const endYear = 2026;
                const allTeamEvents = [];
                for (let yr = startYear; yr <= endYear; yr++) {
                    const eventsUrl = `https://www.thebluealliance.com/api/v3/team/frc${team.teamNumber}/events/${yr}`;
                    const eventsRes = await fetch(eventsUrl, { headers: { "X-TBA-Auth-Key": FRC_CONFIG.apiKey } });
                    if (eventsRes.ok) {
                        const yrEvents = await eventsRes.json();
                        allTeamEvents.push(...yrEvents);
                    }
                }
                team.events = allTeamEvents.sort((a, b) => b.year - a.year || b.start_date.localeCompare(a.start_date));
            } catch (e) {
                console.error("Detail load failed for " + team.teamNumber, e);
            }
        },

        eventCache: {},
        async getEventName(eventKey) {
            if (this.eventCache[eventKey]) return this.eventCache[eventKey];
            try {
                const res = await fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}`, {
                    headers: { "X-TBA-Auth-Key": FRC_CONFIG.apiKey }
                });
                if (res.ok) {
                    const data = await res.json();
                    this.eventCache[eventKey] = data.name;
                    return data.name;
                }
            } catch (e) { }
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

            // 1. Regional / Event Filter
            if (this.selectedEvents.length > 0) {
                list = list.filter(t =>
                    t.eventKeys?.some(key => this.selectedEvents.includes(key))
                );
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
        }
    }));
});
