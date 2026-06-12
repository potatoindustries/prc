// theme.js - Pełna synchronizacja trybu ciemnego na wszystkich podstronach

(function() {
    // Stałe
    const STORAGE_KEY = 'wrc_theme_mode';
    const DARK_CLASS = 'dark';
    
    // Zmienna do przechowywania aktualnego trybu
    let currentTheme = null;
    
    // Główna funkcja ustawiająca tryb (BEZ WARUNKÓW)
    function applyTheme(isDark, saveToStorage = true) {
        // Zawsze aplikuj tryb niezależnie od aktualnego stanu
        if (isDark) {
            document.body.classList.add(DARK_CLASS);
            currentTheme = 'dark';
        } else {
            document.body.classList.remove(DARK_CLASS);
            currentTheme = 'light';
        }
        
        // Aktualizuj logo
        const floatingLogo = document.querySelector('.floating-logo');
        if (floatingLogo) {
            if (isDark) {
                floatingLogo.classList.add('logo--dark');
            } else {
                floatingLogo.classList.remove('logo--dark');
            }
        }
        
        // Zapisz do localStorage jeśli wymagane
        if (saveToStorage) {
            try {
                localStorage.setItem(STORAGE_KEY, currentTheme);
                console.log(`[Theme] Zapisano tryb: ${currentTheme}`);
            } catch(e) {
                console.warn('[Theme] Nie udało się zapisać do localStorage:', e);
            }
        }
        
        // Wyślij zdarzenie o zmianie trybu
        const event = new CustomEvent('themeChanged', { detail: { theme: currentTheme, isDark: isDark } });
        document.dispatchEvent(event);
        
        console.log(`[Theme] Zastosowano tryb: ${currentTheme} na stronie: ${window.location.pathname}`);
    }
    
    // Funkcja do ładowania trybu z localStorage
    function loadTheme() {
        // Wyłącz animacje na czas ładowania
        document.body.classList.add('no-transition');
        
        let savedTheme = null;
        
        try {
            savedTheme = localStorage.getItem(STORAGE_KEY);
        } catch(e) {
            console.warn('[Theme] Nie można odczytać localStorage:', e);
        }
        
        let shouldBeDark = false;
        
        if (savedTheme === 'dark') {
            shouldBeDark = true;
            console.log('[Theme] Wczytano zapisany tryb: ciemny');
        } else if (savedTheme === 'light') {
            shouldBeDark = false;
            console.log('[Theme] Wczytano zapisany tryb: jasny');
        } else {
            // Brak zapisanego trybu - użyj preferencji systemowej
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            shouldBeDark = prefersDark;
            console.log(`[Theme] Brak zapisanego trybu - użyto preferencji systemowej: ${shouldBeDark ? 'ciemny' : 'jasny'}`);
            
            // Zapisz preferencję systemową jako domyślną
            try {
                localStorage.setItem(STORAGE_KEY, shouldBeDark ? 'dark' : 'light');
            } catch(e) {}
        }
        
        // ZASTOSUJ TRYB - zawsze bez zapisywania (już jest zapisany)
        applyTheme(shouldBeDark, false);
        
        // Przywróć animacje po krótkim czasie
        setTimeout(() => {
            document.body.classList.remove('no-transition');
        }, 50);
    }
    
    // Funkcja do przełączania trybu
    function toggleTheme() {
        const newIsDark = !document.body.classList.contains(DARK_CLASS);
        console.log(`[Theme] Przełączanie na tryb: ${newIsDark ? 'ciemny' : 'jasny'}`);
        
        // ZASTOSUJ i ZAPISZ
        applyTheme(newIsDark, true);
        
        // Dodaj efekt animacji
        document.body.classList.add('theme-animating');
        setTimeout(() => {
            document.body.classList.remove('theme-animating');
        }, 500);
        
        // Wyślij zdarzenie do ewentualnych innych komponentów
        const toggleEvent = new CustomEvent('themeToggled', { detail: { isDark: newIsDark } });
        document.dispatchEvent(toggleEvent);
    }
    
    // Funkcja do ustawiania konkretnego trybu
    function setTheme(isDark) {
        if (currentTheme === (isDark ? 'dark' : 'light')) {
            console.log('[Theme] Tryb już ustawiony, pomijam');
            return;
        }
        console.log(`[Theme] Ręczne ustawianie trybu na: ${isDark ? 'ciemny' : 'jasny'}`);
        applyTheme(isDark, true);
    }
    
    // Inicjalizacja przycisków
    function initButtons() {
        const buttons = document.querySelectorAll('.theme-toggle-btn');
        console.log(`[Theme] Znaleziono przycisków: ${buttons.length}`);
        
        buttons.forEach((button, index) => {
            // Usuń stare eventy przez klonowanie
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            
            // Dodaj nowy event
            newButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log(`[Theme] Kliknięto przycisk #${index + 1}`);
                toggleTheme();
                return false;
            });
        });
    }
    
    // Nasłuchiwanie na zmiany w localStorage z innych kart
    function watchStorageChanges() {
        window.addEventListener('storage', function(e) {
            if (e.key === STORAGE_KEY && e.newValue !== e.oldValue) {
                console.log(`[Theme] Wykryto zmianę w localStorage z innej karty: ${e.newValue}`);
                
                const newIsDark = e.newValue === 'dark';
                const currentIsDark = document.body.classList.contains(DARK_CLASS);
                
                if (newIsDark !== currentIsDark) {
                    console.log('[Theme] Synchronizacja z inną kartą');
                    
                    // Wyłącz animacje na czas zmiany
                    document.body.classList.add('no-transition');
                    applyTheme(newIsDark, false);
                    setTimeout(() => {
                        document.body.classList.remove('no-transition');
                    }, 50);
                }
            }
        });
    }
    
    // Obserwator dla dynamicznie dodawanych przycisków
    function observeDynamicButtons() {
        const observer = new MutationObserver(function(mutations) {
            let needInit = false;
            
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            if (node.classList && node.classList.contains('theme-toggle-btn')) {
                                needInit = true;
                            }
                            if (node.querySelectorAll && node.querySelectorAll('.theme-toggle-btn').length > 0) {
                                needInit = true;
                            }
                        }
                    });
                }
            });
            
            if (needInit) {
                console.log('[Theme] Wykryto nowe przyciski, inicjalizacja...');
                initButtons();
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // Synchronizacja przy każdym przejściu między stronami (dla SPA)
    function watchPageVisibility() {
        // Dla stron z bfcache (szybkie cofanie)
        window.addEventListener('pageshow', function(event) {
            if (event.persisted) {
                console.log('[Theme] Strona wczytana z bfcache, synchronizacja...');
                setTimeout(() => {
                    loadTheme();
                    initButtons();
                }, 0);
            }
        });
        
        // Dla standardowych nawigacji
        window.addEventListener('load', function() {
            console.log('[Theme] Zdarzenie load - finalna synchronizacja');
            setTimeout(() => {
                const saved = localStorage.getItem(STORAGE_KEY);
                const currentIsDark = document.body.classList.contains(DARK_CLASS);
                const shouldBeDark = saved === 'dark';
                
                if (currentIsDark !== shouldBeDark) {
                    console.log('[Theme] Korekta po załadowaniu strony');
                    applyTheme(shouldBeDark, false);
                }
                initButtons();
            }, 10);
        });
    }
    
    // Eksport globalnego API
    window.WRCTheme = {
        toggle: toggleTheme,
        setDark: () => setTheme(true),
        setLight: () => setTheme(false),
        getCurrent: () => currentTheme || (document.body.classList.contains(DARK_CLASS) ? 'dark' : 'light'),
        sync: loadTheme
    };
    
    // Uruchomienie
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            console.log('[Theme] DOMContentLoaded - inicjalizacja');
            loadTheme();
            initButtons();
            watchStorageChanges();
            observeDynamicButtons();
            watchPageVisibility();
        });
    } else {
        console.log('[Theme] Dokument już załadowany - natychmiastowa inicjalizacja');
        loadTheme();
        initButtons();
        watchStorageChanges();
        observeDynamicButtons();
        watchPageVisibility();
    }
    
    // Dodatkowe zabezpieczenie: sprawdź po 100ms czy tryb jest poprawny
    setTimeout(function() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const currentIsDark = document.body.classList.contains(DARK_CLASS);
            const shouldBeDark = saved === 'dark';
            
            if (currentIsDark !== shouldBeDark) {
                console.warn('[Theme] Wykryto niezgodność trybu, korygowanie...');
                applyTheme(shouldBeDark, false);
                initButtons();
            }
        }
    }, 100);
})();