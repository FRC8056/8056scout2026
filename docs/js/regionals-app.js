document.addEventListener('alpine:init', () => {
    Alpine.data('regionalsApp', () => ({
        searchQuery: '', // Global regional search
        teamSearchQuery: '', // Search inside expanded regional
        expandedRegionals: [],
        regionalData: {}, // Map eventKey -> { matches: [], rankings: [], awards: [], loading: false, teams: [] }
        eventTeamsMap: {}, // Map eventKey -> [teamNumbers] for global search
        pitReports: {}, // Map teamNumber -> [reports]
        availableEvents: FRC_CONFIG.events,
        availableSeasons: FRC_CONFIG.seasons,
        expandedMatches: [],
        expandedReports: [],
        expandedTeams: [],
        expandedHistory: [],
        expandedPitReports: [],

        get isAdmin() {
            return Alpine.store('auth').profile?.role === 'admin' ||
                Alpine.store('auth').profile?.role === 'team8056';
        },

        async init() {
            // Background fetch all event team lists for global search
            this.availableEvents.filter(e => e.season === 2026).forEach(async event => {
                const teams = await this.fetchTBARequest(`event/${event.key}/teams/keys`);
                if (teams) {
                    this.eventTeamsMap[event.key] = teams.map(tk => parseInt(tk.replace('frc', '')));
                }
            });

            // Load ALL Pit Reports for the season (season-wide)
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

                // Sort by date newest first
                Object.keys(this.pitReports).forEach(num => {
                    this.pitReports[num].sort((a, b) => {
                        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                        return dateB - dateA;
                    });
                });
            });
        },

        get filteredRegionals() {
            if (!this.searchQuery) return this.availableEvents.filter(e => e.season === 2026);
            const q = this.searchQuery.toLowerCase();
            return this.availableEvents.filter(e =>
                e.name.toLowerCase().includes(q) ||
                e.key.toLowerCase().includes(q) ||
                (this.eventTeamsMap[e.key] && this.eventTeamsMap[e.key].some(num => num.toString().includes(q)))
            );
        },

        async toggleRegional(eventKey) {
            if (this.expandedRegionals.includes(eventKey)) {
                this.expandedRegionals = this.expandedRegionals.filter(k => k !== eventKey);
            } else {
                this.expandedRegionals.push(eventKey);
                if (!this.regionalData[eventKey]) {
                    await this.loadRegionalData(eventKey);
                }
            }
        },

        async loadRegionalData(eventKey) {
            this.regionalData[eventKey] = {
                matches: [],
                rankings: null,
                awards: [],
                loading: true,
                teams: []
            };

            try {
                const [matches, rankings, awards, eventTeams] = await Promise.all([
                    fetchFRCMatches(eventKey),
                    this.fetchTBARequest(`event/${eventKey}/rankings`),
                    this.fetchTBARequest(`event/${eventKey}/awards`),
                    this.fetchTBARequest(`event/${eventKey}/teams`)
                ]);

                // Sort matches OLD to NEW (Ascending)
                this.regionalData[eventKey].matches = matches.sort((a, b) => {
                    const timeA = a.actualStartTime ? new Date(a.actualStartTime).getTime() : 9999999999999;
                    const timeB = b.actualStartTime ? new Date(b.actualStartTime).getTime() : 9999999999999;
                    return timeA - timeB;
                });

                this.regionalData[eventKey].rankings = rankings;
                this.regionalData[eventKey].awards = awards;

                // Always have teams list available for fallback or expansion
                this.regionalData[eventKey].teams = (eventTeams || []).map(t => ({
                    teamNumber: t.team_number,
                    name: t.nickname || t.name,
                    city: t.city,
                    country: t.country,
                    awards: [],
                    events: [],
                    logoUrl: null,
                    loadingDetails: false
                })).sort((a, b) => a.teamNumber - b.teamNumber);

                // Replace the whole entry to trigger Alpine reactivity
                this.regionalData[eventKey] = { ...this.regionalData[eventKey] };

            } catch (err) {
                console.error("Failed to load regional data:", err);
            } finally {
                this.regionalData[eventKey].loading = false;
                this.regionalData[eventKey] = { ...this.regionalData[eventKey] };
            }
        },

        getFilteredMatches(eventKey) {
            const matches = this.regionalData[eventKey]?.matches || [];
            if (!this.teamSearchQuery) return matches;
            const q = this.teamSearchQuery.toLowerCase();
            const teams = this.regionalData[eventKey]?.teams || [];

            return matches.filter(m => {
                const matchNumMatch = m.matchNumber.toString().includes(q);
                const teamMatch = m.teams?.some(mt => {
                    const teamNum = mt.teamNumber.toString();
                    if (teamNum.includes(q)) return true;
                    const team = teams.find(t => t.teamNumber === mt.teamNumber);
                    return team?.name?.toLowerCase().includes(q);
                });
                return matchNumMatch || teamMatch;
            });
        },

        getFilteredRankings(eventKey) {
            const data = this.regionalData[eventKey];
            if (!data) return [];

            let list = [];
            if (data.rankings && data.rankings.rankings && data.rankings.rankings.length > 0) {
                list = data.rankings.rankings;
            } else if (data.teams) {
                // Fallback: show teams if no rankings yet
                list = data.teams.map((t, i) => ({
                    rank: '-',
                    team_key: 'frc' + t.teamNumber,
                    matches_played: 0,
                    record: { wins: 0, losses: 0, ties: 0 }
                }));
            }

            if (!this.teamSearchQuery) return list;
            const q = this.teamSearchQuery.toLowerCase();
            return list.filter(r => {
                const teamNum = r.team_key.replace('frc', '');
                const teamName = data.teams?.find(t => t.teamNumber === parseInt(teamNum))?.name || '';
                return teamNum.includes(q) || teamName.toLowerCase().includes(q);
            });
        },

        getFilteredAwards(eventKey) {
            const awards = this.regionalData[eventKey]?.awards || [];
            const q = this.teamSearchQuery.toLowerCase();
            if (!q) return awards;
            return awards.filter(a =>
                a.name.toLowerCase().includes(q) ||
                a.recipient_list?.some(r => r.team_key?.replace('frc', '').includes(q) || r.awardee?.toLowerCase().includes(q))
            );
        },

        getRankData(rank, label, eventKey) {
            if (!rank || !this.regionalData[eventKey]) return '-';
            const data = this.regionalData[eventKey].rankings;
            const info = data?.sort_order_info;

            // Special case for Total RP (Integers)
            if (label === 'Ranking Points') {
                return rank.sort_orders ? Math.round(rank.sort_orders[0] * rank.matches_played) : '0';
            }

            if (!info || !rank.sort_orders) return '-';
            const index = info.findIndex(i => i.name === label);
            return index !== -1 ? (rank.sort_orders[index]?.toFixed(2) || '0') : '-';
        },

        async fetchTBARequest(endpoint) {
            const url = `https://www.thebluealliance.com/api/v3/${endpoint}`;
            const res = await fetch(url, {
                headers: { "X-TBA-Auth-Key": FRC_CONFIG.apiKey }
            });
            return res.ok ? await res.json() : null;
        },

        async toggleTeam(teamNumber, eventKey) {
            const teamKey = `${eventKey}_${teamNumber}`;
            if (this.expandedTeams.includes(teamKey)) {
                this.expandedTeams = this.expandedTeams.filter(tk => tk !== teamKey);
            } else {
                this.expandedTeams.push(teamKey);
                const team = this.regionalData[eventKey].teams.find(t => t.teamNumber === teamNumber);
                if (team && (!team.awards.length || !team.events.length)) {
                    await this.loadTeamDetail(team);
                }
            }
        },

        async loadTeamDetail(team) {
            team.loadingDetails = true;
            try {
                // Media
                const media = await this.fetchTBARequest(`team/frc${team.teamNumber}/media/2025`);
                const logo = media?.find(m => m.type === 'avatar' || m.type === 'image');
                if (logo) {
                    team.logoUrl = logo.direct_url || (logo.details?.base64_avatar ? `data:image/png;base64,${logo.details.base64_avatar}` : null);
                }

                // Awards
                const awards = await this.fetchTBARequest(`team/frc${team.teamNumber}/awards`);
                team.awards = awards?.slice(0, 10) || [];

                // Events
                const events = await this.fetchTBARequest(`team/frc${team.teamNumber}/events/2026`);
                team.events = events || [];
            } finally {
                team.loadingDetails = false;
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
            this.expandedReports.includes(id)
                ? this.expandedReports = this.expandedReports.filter(i => i !== id)
                : this.expandedReports.push(id);
        },

        togglePitReport(id) {
            this.expandedPitReports.includes(id)
                ? this.expandedPitReports = this.expandedPitReports.filter(i => i !== id)
                : this.expandedPitReports.push(id);
        },

        formatDate(timestamp) {
            if (!timestamp) return 'No Time';
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) return 'No Time';
            return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        },

        isVerified(role) {
            return role && role !== 'new';
        },

        isHighlighted(teamNumber) {
            if (!this.searchQuery) return false;
            return teamNumber.toString().includes(this.searchQuery);
        }
    }));
});
