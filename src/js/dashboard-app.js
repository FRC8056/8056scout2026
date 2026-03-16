document.addEventListener('alpine:init', () => {
    Alpine.data('dashboardApp', () => ({
        isAdmin: false,

        init() {
            auth.onAuthStateChanged(async user => {
                if (user) {
                    this.isAdmin = await window.isAdmin(user);
                } else {
                    location.href = 'index.html';
                }
            });
        }
    }));
});
