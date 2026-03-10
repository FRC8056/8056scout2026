document.addEventListener('alpine:init', () => {
    Alpine.data('scoutApp', () => ({
        selectedYear: FRC_CONFIG.defaultSeason,
        availableSeasons: FRC_CONFIG.seasons,
        regional: '',

        get filteredEvents() {
            return FRC_CONFIG.events.filter(e => e.season === Number(this.selectedYear));
        },

        init() {
            // Handle URL Parameters
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('season')) this.selectedYear = urlParams.get('season');
            if (urlParams.has('regional')) this.regional = urlParams.get('regional');
            if (urlParams.has('type')) this.matchType = urlParams.get('type');
            if (urlParams.has('match')) this.matchNumber = urlParams.get('match');
            if (urlParams.has('team')) this.teamNumber = urlParams.get('team');

            // Watch for year changes to reset regional
            this.$watch('selectedYear', (val) => {
                const firstEvent = this.filteredEvents[0];
                if (firstEvent) this.regional = firstEvent.key;
            });

            // Set initial regional if empty
            if (!this.regional) {
                const firstEvent = this.filteredEvents[0];
                if (firstEvent) this.regional = firstEvent.key;
            }
        },

        matchNumber: '',
        teamNumber: '',
        matchType: 'Qualification',
        alliance: '',

        // Counter Definitions
        get autoRanges() {
            return ['0', '1-5', '5-10', '10-15', '15-20'];
        },
        get teleopRanges() {
            const ranges = ['0', '1-5', '5-10', '10-15', '15-20', '20-25', '25-30', '30-40', '40-50', '50-60', '60-70', '70-80', '80-95', '95-110', '110-130', '130-150', '150-180', '180-210', '210-250', '250-300'];
            return ranges;
        },

        auto: { level1: 'none', scored: '0', failed: '0' },
        transitionShift: '0',
        teleopShiftA: '0',
        teleopShiftB: '0',
        endgameShiftA: '0',
        endgameShiftB: '0',
        endgame: { level: 'none', climbTime: null },
        ratings: { driver: 3, speed: 3, shooterSpeed: 3, defense: 3, stability: 3, comments: '' },
        isTestData: false,
        loading: false,

        // Timer State
        timerActive: false,
        timerSeconds: 0,
        timerInterval: null,
        recordedClimbTime: null,

        startTimer() {
            if (this.timerActive) return;
            this.timerActive = true;
            this.timerInterval = setInterval(() => {
                this.timerSeconds += 0.1;
            }, 100);
        },

        stopTimer() {
            clearInterval(this.timerInterval);
            this.timerActive = false;
        },

        resetTimer() {
            this.stopTimer();
            this.timerSeconds = 0;
            this.recordedClimbTime = null;
            this.endgame.climbTime = null;
        },

        recordClimb() {
            this.stopTimer();
            this.recordedClimbTime = this.timerSeconds.toFixed(1);
            this.endgame.climbTime = Number(this.recordedClimbTime);
        },

        increment(section, key) {
            this[section][key] = (this[section][key] || 0) + 1;
        },

        decrement(section, key) {
            this[section][key] = Math.max(0, (this[section][key] || 0) - 1);
        },

        async submit() {
            if (!this.matchNumber || !this.teamNumber) return alert('Match and Team numbers are required');
            this.loading = true;
            try {
                // Fetch scouter's profile for team number and role
                let scouterTeam = 0;
                let scouterRole = 'new';
                try {
                    const uid = auth.currentUser?.uid;
                    if (uid) {
                        const profileSnap = await db.collection('users').doc(uid).get();
                        if (profileSnap.exists) {
                            const profile = profileSnap.data();
                            scouterTeam = profile.teamNumber || 0;
                            scouterRole = profile.role || 'new';
                        }
                    }
                } catch (_) { }

                const data = {
                    regional: this.regional,
                    matchNumber: Number(this.matchNumber),
                    teamNumber: Number(this.teamNumber),
                    meta: {
                        matchType: this.matchType,
                        alliance: this.alliance,
                        scouterEmail: auth.currentUser?.email,
                        scouterUID: auth.currentUser?.uid,
                        scouterTeam: scouterTeam,
                        scouterRole: scouterRole,
                        isVerified: scouterRole !== 'new',
                        isTestData: this.isTestData,
                        domain: FRC_CONFIG.currentDomain
                    },
                    data: {
                        auto: { ...this.auto },
                        transitionShift: this.transitionShift,
                        teleopShiftA: this.teleopShiftA,
                        teleopShiftB: this.teleopShiftB,
                        endgameShiftA: this.endgameShiftA,
                        endgameShiftB: this.endgameShiftB,
                        endgame: { ...this.endgame },
                        ratings: { ...this.ratings },
                    },
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await db.collection('scouting').add(data);
                alert('Success!');
                location.href = 'dashboard.html';
            } catch (e) {
                alert('Error: ' + e.message);
                this.loading = false;
            }
        }
    }));
});
