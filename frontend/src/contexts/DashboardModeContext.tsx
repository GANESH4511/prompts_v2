"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type DashboardMode = 'nlp' | 'developer';

interface DashboardModeContextType {
    mode: DashboardMode;
    setMode: (mode: DashboardMode) => void;
    toggleMode: () => void;
    getDashboardRoute: () => string;
}

const DashboardModeContext = createContext<DashboardModeContextType | undefined>(undefined);

const MODE_KEY = 'dashboardMode';

export function DashboardModeProvider({ children }: { children: ReactNode }) {
    const [mode, setModeState] = useState<DashboardMode>('nlp');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        const savedMode = localStorage.getItem(MODE_KEY) as DashboardMode;
        if (savedMode && (savedMode === 'nlp' || savedMode === 'developer')) {
            setModeState(savedMode);
        }
    }, []);

    useEffect(() => {
        if (mounted) {
            localStorage.setItem(MODE_KEY, mode);
        }
    }, [mode, mounted]);

    const setMode = (newMode: DashboardMode) => {
        setModeState(newMode);
    };

    const toggleMode = () => {
        setModeState(prev => prev === 'nlp' ? 'developer' : 'nlp');
    };

    const getDashboardRoute = () => {
        return mode === 'developer' ? '/dev-dashboard' : '/new-dashboard';
    };

    return (
        <DashboardModeContext.Provider value={{ mode, setMode, toggleMode, getDashboardRoute }}>
            {children}
        </DashboardModeContext.Provider>
    );
}

export function useDashboardMode() {
    const context = useContext(DashboardModeContext);
    if (context === undefined) {
        throw new Error('useDashboardMode must be used within a DashboardModeProvider');
    }
    return context;
}
