document.addEventListener('alpine:init', () => {
    Alpine.data('statisticsApp', () => ({
        isAdmin: false,
        stats: {
            scoutedMatches: 0,
            pitReports: 0,
            totalUsers: 0,
            totalRegionals: 0,
            totalTeams: 0,
            topScouterTeams: [],
            topScoutedRegionals: [],
            topScoutedTeams: [],
            topUserTeams: []
        },
        loadingStats: true,

        async init() {
            auth.onAuthStateChanged(async user => {
                if (user) {
                    this.isAdmin = await window.isAdmin(user);
                    await this.loadStats();
                } else {
                    location.href = 'index.html';
                }
            });
        },

        async loadStats() {
            this.loadingStats = true;
            try {
                // 1. Basic Counts
                const scoutSnap = await db.collection('scouting').get();
                const pitSnap = await db.collection('pitScouting').get();
                const userSnap = await db.collection('users').get();

                this.stats.scoutedMatches = scoutSnap.size;
                this.stats.pitReports = pitSnap.size;
                this.stats.totalUsers = userSnap.size;
                this.stats.totalRegionals = FRC_CONFIG.events.length;

                // 2. Leaderboard Calculations
                const scouterTeamsCount = {};
                const scoutedRegionalsCount = {};
                const scoutedTeamsCount = {};
                const uniqueTeams = new Set();

                // Process Scouted Matches
                scoutSnap.forEach(doc => {
                    const data = doc.data();

                    // Most scouted teams
                    const team = data.teamNumber;
                    if (team) {
                        scoutedTeamsCount[team] = (scoutedTeamsCount[team] || 0) + 1;
                        uniqueTeams.add(team);
                    }

                    // Most scouted regionals
                    const reg = data.regional;
                    if (reg) {
                        scoutedRegionalsCount[reg] = (scoutedRegionalsCount[reg] || 0) + 1;
                    }

                    // Scouter teams
                    const scouterTeam = data.meta?.scouterTeam;
                    if (scouterTeam) {
                        scouterTeamsCount[scouterTeam] = (scouterTeamsCount[scouterTeam] || 0) + 1;
                    }
                });

                // Process Pit Reports
                pitSnap.forEach(doc => {
                    const data = doc.data();
                    const team = data.teamNumber;
                    if (team) uniqueTeams.add(team);

                    const scouterTeam = data.meta?.scouterTeam;
                    if (scouterTeam) {
                        scouterTeamsCount[scouterTeam] = (scouterTeamsCount[scouterTeam] || 0) + 1;
                    }
                });

                this.stats.totalTeams = uniqueTeams.size;

                const sortStats = (obj) => Object.entries(obj)
                    .map(([key, count]) => ({ key, count }))
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 10);

                this.stats.topScouterTeams = sortStats(scouterTeamsCount);
                this.stats.topScoutedRegionals = sortStats(scoutedRegionalsCount).map(item => ({
                    ...item,
                    name: FRC_CONFIG.events.find(e => e.key === item.key)?.name || item.key
                }));
                this.stats.topScoutedTeams = sortStats(scoutedTeamsCount);

                const userTeamsCount = {};
                userSnap.forEach(doc => {
                    const team = doc.data().scouterTeam;
                    if (team) userTeamsCount[team] = (userTeamsCount[team] || 0) + 1;
                });
                this.stats.topUserTeams = sortStats(userTeamsCount);

            } catch (err) {
                console.error("Failed to load statistics:", err);
            } finally {
                this.loadingStats = false;
            }
        }
    }));
});
