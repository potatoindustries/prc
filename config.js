// ============================================
// KONFIGURACJA APLIKACJI - WYPEŁNIJ SWOJE DANE
// ============================================

const CONFIG = {
    JSONBIN: {
        API_KEY: '$2a$10$VsoQROU7MdLnmfsQggP/Kuq5jIrZzxTRB./nHz5Bbj2DfzuV8Yfey',
        BIN_ID: '69b2f690aa77b81da9dc6330',
        URL: 'https://api.jsonbin.io/v3/b'
    },
    
    DEFAULTS: {
        POINTS_SYSTEM: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        POWER_STAGE_POINTS: [5, 4, 3, 2, 1],
        TEAM_POINTS_COUNT: 2,
        BONUS_NONE: 2,
        BONUS_LIGHT: 1,
        BONUS_HEAVY: 0
    },
    
    DRIVER_STATUS: {
        OK: 'OK',
        DNF: 'DNF',
        DNS: 'DNS',
        DSQ: 'DSQ',
        RET: 'RET'
    },
    
    RALLY_STATUS: {
        UPCOMING: 'upcoming',
        ONGOING: 'ongoing',
        COMPLETED: 'completed'
    }
};