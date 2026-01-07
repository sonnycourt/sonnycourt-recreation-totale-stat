// Helper function to protect cron job data from manual overwrites
// This function checks if an entry exists with from_cron: true and prevents overwriting

/**
 * Checks if a date entry is protected (created by cron job)
 * @param {Object} history - The history object (views-history or subscribers-monthly-history)
 * @param {string} dateKey - The date key to check (e.g., "2026-01-07" or "2026-01")
 * @returns {boolean} - True if the entry is protected (from_cron: true)
 */
export function isCronProtected(history, dateKey) {
    if (!history || !history[dateKey]) {
        return false;
    }
    return history[dateKey].from_cron === true;
}

/**
 * Safely updates history, protecting cron entries
 * @param {Object} history - The history object
 * @param {string} dateKey - The date key to update
 * @param {Object} newData - The new data to save
 * @param {boolean} isCronJob - Whether this update is from a cron job (always allowed)
 * @returns {Object} - Updated history object
 */
export function safeUpdateHistory(history, dateKey, newData, isCronJob = false) {
    if (!history) {
        history = {};
    }

    // Cron jobs can always overwrite (including their own entries)
    if (isCronJob) {
        history[dateKey] = { ...newData, from_cron: true };
        return history;
    }

    // Manual updates: check if entry is protected
    if (isCronProtected(history, dateKey)) {
        console.log(`⚠️ Entry for ${dateKey} is protected (from cron job). Manual update skipped.`);
        return history; // Don't overwrite
    }

    // Manual update allowed (no protection)
    history[dateKey] = { ...newData, from_cron: false };
    return history;
}

