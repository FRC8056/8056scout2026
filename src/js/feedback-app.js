document.addEventListener('alpine:init', () => {
    Alpine.data('feedbackApp', () => ({
        feedbacks: [],
        loading: true,
        showForm: false,
        submitting: false,
        ratings: {
            'Performance': 5,
            'Design': 5,
            'Ease of Use': 5
        },
        comment: '',
        isTest: false,
        currentUser: null,

        async init() {
            // Wait for user auth
            auth.onAuthStateChanged(async (user) => {
                if (!user) {
                    location.href = 'index.html';
                    return;
                }

                // Get full user profile
                const doc = await db.collection('users').doc(user.uid).get();
                this.currentUser = { uid: user.uid, ...doc.data() };

                await this.loadFeedbacks();
            });
        },

        async loadFeedbacks() {
            this.loading = true;
            db.collection('feedbacks')
                .orderBy('createdAt', 'desc')
                .onSnapshot(snapshot => {
                    this.feedbacks = [];
                    snapshot.forEach(doc => {
                        this.feedbacks.push({ id: doc.id, ...doc.data() });
                    });
                    this.loading = false;
                });
        },

        async submitFeedback() {
            if (!this.comment || this.submitting) return;

            this.submitting = true;
            try {
                const feedbackData = {
                    userName: this.currentUser.fullName || 'Anonymous Scout',
                    userVerified: this.currentUser.role !== 'new',
                    fromTeam: this.currentUser.teamNumber || '0000',
                    fromTeamName: this.currentUser.teamNickname || 'Independent',
                    ratings: this.ratings,
                    comment: this.comment,
                    isTest: this.isTest,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                await db.collection('feedbacks').add(feedbackData);

                // Reset form
                this.comment = '';
                this.ratings = { 'Performance': 5, 'Design': 5, 'Ease of Use': 5 };
                this.isTest = false;
                this.showForm = false;
                alert("Thank you for your feedback!");
            } catch (err) {
                console.error("Feedback error:", err);
                alert("Failed to submit feedback. Try again.");
            } finally {
                this.submitting = false;
            }
        },

        formatDate(timestamp) {
            if (!timestamp) return 'Just now';
            const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return date.toLocaleString();
        }
    }));
});
