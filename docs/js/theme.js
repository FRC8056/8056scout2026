(function () {
    // Initial theme setting is removed as dark mode is enforced continuously.
    // The immediate dark mode enforcement is handled below.
})();

// Alpine.js integration
document.addEventListener('alpine:init', () => {
    Alpine.store('theme', {
        isLight: false, // Always false, indicating dark mode

        init() {
            document.documentElement.classList.add('dark'); // Enforce dark mode when Alpine initializes
            document.documentElement.classList.remove('light'); // Ensure light mode is removed
            localStorage.setItem('theme', 'dark'); // Persist dark mode preference
        },

        toggle() {
            // Feature removed. Always dark.
            // This method now does nothing, as dark mode is continuously enforced.
        }
    });

    // Run this immediately rather than waiting for Alpine to init so flash is minimized
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light'); // Ensure light mode is removed
    localStorage.setItem('theme', 'dark'); // Persist dark mode preference
});
