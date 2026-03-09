/* ============================================================
   TBA API CONFIGURATION (WORKS IN BROWSER – NO CORS ISSUES)
   Replace ONLY the apiKey and eventKey
   ============================================================ */

const DEFAULT_EVENTS = [
    { key: "2026tuis", name: "Istanbul Regional 2026", season: 2026 },
    { key: "2026tuis2", name: "Bosphorus Regional 2026", season: 2026 },
    { key: "2026tuis4", name: "Yeditepe Regional 2026", season: 2026 },
    { key: "2026tuhc", name: "Haliç Regional 2026", season: 2026 },
    { key: "2026marmara", name: "Marmara Regional 2026", season: 2026 },
    { key: "2026tuis5", name: "Avrasya Regional 2026", season: 2026 },
    { key: "2026baskent", name: "Başkent Regional 2026", season: 2026 },
    { key: "2026tuak", name: "Ankara Regional 2026", season: 2026 },
    { key: "2025tuhc", name: "Haliç Regional 2025", season: 2025 },
    { key: "2025tuis", name: "Istanbul Regional 2025", season: 2025 },
    { key: "2025tumb", name: "Marmara Regional 2025", season: 2025 },
    { key: "2025tubk", name: "Bosphorus Regional 2025", season: 2025 }
];

// Combine hardcoded events with custom ones (custom ones override defaults)
const ALL_EVENTS = [...DEFAULT_EVENTS];
if (typeof CUSTOM_EVENTS !== 'undefined' && Array.isArray(CUSTOM_EVENTS)) {
    CUSTOM_EVENTS.forEach(ce => {
        const index = ALL_EVENTS.findIndex(de => de.key === ce.key);
        if (index !== -1) {
            ALL_EVENTS[index] = ce; // Override existing
        } else {
            ALL_EVENTS.push(ce); // Add new
        }
    });
}

// Generate unique seasons from the events list
const ALL_SEASONS = [...new Set(ALL_EVENTS.map(e => e.season))].sort((a, b) => b - a);

const FRC_CONFIG = {
    seasons: ALL_SEASONS,
    events: ALL_EVENTS,
    defaultSeason: 2026,
    apiKey: "kIarej54aLEjhvDFU7w4ky7cm3vsrhfi3zGZHU4Kbb0qgBV23gnlZ5coU6bz3ptJ",
    level: ["qf", "sf", "f", "p", "qm"],
    scoring: {
        2026: {
            fuelValue: 1,
            autoLevel1: 15,
            endgameLevel1: 10,
            endgameLevel2: 20,
            endgameLevel3: 30
        }
    },
    manualTeamsPath: "data/teams-manual.json",
    // Auto-detected domain: identifies which deployment is active
    currentDomain: window.location.hostname
};

/* Fetches match results from The Blue Alliance API */
async function fetchFRCMatches(eventKey) {
    const key = eventKey || FRC_CONFIG.events[0].key;
    const url = `https://www.thebluealliance.com/api/v3/event/${key}/matches`;

    const res = await fetch(url, {
        headers: {
            "X-TBA-Auth-Key": FRC_CONFIG.apiKey
        }
    });

    if (!res.ok) {
        if (res.status === 404) {
            console.warn(`TBA API: Event ${key} not found (might be a future event).`);
            return [];
        }
        throw new Error(`TBA API error: ${res.status}`);
    }

    const data = await res.json();

    // Map TBA comp_levels to readable names
    const levelNames = {
        'qm': 'Qualification',
        'p': 'Practice',
        'qf': 'Playoffs',
        'sf': 'Playoffs',
        'f': 'Playoffs'
    };

    // Convert TBA format → FIRST API format (so your matches.js works unchanged)
    return data.map(match => {
        const redTeams = match.alliances.red.team_keys.map((t, i) => ({
            teamNumber: parseInt(t.replace("frc", "")),
            station: `Red${i + 1}`,
            dq: false
        }));

        const blueTeams = match.alliances.blue.team_keys.map((t, i) => ({
            teamNumber: parseInt(t.replace("frc", "")),
            station: `Blue${i + 1}`,
            dq: false
        }));

        let description = '';
        if (match.comp_level === 'qm') {
            description = `Qualification ${match.match_number}`;
        } else if (match.comp_level === 'p') {
            description = `Practice ${match.match_number}`;
        } else if (match.comp_level === 'f') {
            description = `Final ${match.match_number}`;
        } else if (match.comp_level === 'sf' || match.comp_level === 'qf') {
            description = `Match ${match.set_number}`;
        } else {
            description = `Match ${match.set_number}-${match.match_number}`;
        }

        return {
            matchNumber: match.match_number,
            description: description,
            compLevel: match.comp_level,
            actualStartTime: match.actual_time
                ? new Date(match.actual_time * 1000).toISOString()
                : null,
            scoreRedFinal: match.alliances.red.score ?? 0,
            scoreBlueFinal: match.alliances.blue.score ?? 0,
            scoreRedAuto: match.score_breakdown?.red?.autoPoints ?? null,
            scoreBlueAuto: match.score_breakdown?.blue?.autoPoints ?? null,
            scoreRedFoul: match.score_breakdown?.red?.foulPoints ?? null,
            scoreBlueFoul: match.score_breakdown?.blue?.foulPoints ?? null,
            // Normalized breakdown — always present if match was scored
            scoreBreakdown: match.score_breakdown ? {
                red: {
                    autoPoints: match.score_breakdown.red?.autoPoints ?? match.score_breakdown.red?.autoTotal ?? null,
                    autoLeavePoints: match.score_breakdown.red?.autoLeavePoints ?? 0,
                    teleopPoints: match.score_breakdown.red?.teleopPoints ?? match.score_breakdown.red?.teleopTotal ?? null,
                    endGamePoints: match.score_breakdown.red?.endGamePoints ?? match.score_breakdown.red?.endGameTotal ?? null,
                    endGameClimbPoints: match.score_breakdown.red?.endGameClimbPoints ?? 0,
                    foulPoints: match.score_breakdown.red?.foulPoints ?? 0,
                },
                blue: {
                    autoPoints: match.score_breakdown.blue?.autoPoints ?? match.score_breakdown.blue?.autoTotal ?? null,
                    autoLeavePoints: match.score_breakdown.blue?.autoLeavePoints ?? 0,
                    teleopPoints: match.score_breakdown.blue?.teleopPoints ?? match.score_breakdown.blue?.teleopTotal ?? null,
                    endGamePoints: match.score_breakdown.blue?.endGamePoints ?? match.score_breakdown.blue?.endGameTotal ?? null,
                    endGameClimbPoints: match.score_breakdown.blue?.endGameClimbPoints ?? 0,
                    foulPoints: match.score_breakdown.blue?.foulPoints ?? 0,
                }
            } : null,
            teams: [...redTeams, ...blueTeams]
        };
    });
}

/**
 * Fetches team basic info from TBA
 */
async function fetchFRCTeamInfo(teamNumber) {
    const url = `https://www.thebluealliance.com/api/v3/team/frc${teamNumber}`;
    try {
        const res = await fetch(url, {
            headers: { "X-TBA-Auth-Key": FRC_CONFIG.apiKey }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        console.error("Error fetching team info:", e);
        return null;
    }
}

/**
 * Fetches team media (logos) from TBA for a specific year
 */
async function fetchFRCTeamMedia(teamNumber, year = 2025) {
    const url = `https://www.thebluealliance.com/api/v3/team/frc${teamNumber}/media/${year}`;
    try {
        const res = await fetch(url, {
            headers: { "X-TBA-Auth-Key": FRC_CONFIG.apiKey }
        });
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        console.error("Error fetching team media:", e);
        return [];
    }
}

/**
 * Loads manual team data from JSON file
 */
async function loadManualTeams() {
    try {
        const res = await fetch(FRC_CONFIG.manualTeamsPath);
        if (!res.ok) return {};
        return await res.json();
    } catch (e) {
        console.warn("Manual teams file not found, using API only.");
        return {};
    }
}
