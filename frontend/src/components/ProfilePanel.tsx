"use client";

import { useState, useEffect, useRef } from 'react';
import { useTheme } from './ThemeProvider';
import { useDashboardMode, DashboardMode } from '@/contexts/DashboardModeContext';

interface User {
    id: string;
    email: string;
    name: string;
    role: string;
}

interface ProfilePanelProps {
    user: User;
    isOpen: boolean;
    onClose: () => void;
    onLogout: () => void;
}

export function ProfilePanel({ user, isOpen, onClose, onLogout }: ProfilePanelProps) {
    const { theme, setTheme } = useTheme();
    const { mode, setMode } = useDashboardMode();
    const panelRef = useRef<HTMLDivElement>(null);
    const isDark = theme === 'dark';

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);

    // Close on Escape
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            window.addEventListener('keydown', handleEscape);
        }
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-start justify-end p-0" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
            <div
                ref={panelRef}
                className="profile-panel-slide"
                style={{
                    width: '380px',
                    maxWidth: '90vw',
                    height: '100vh',
                    background: isDark ? '#0f172a' : '#ffffff',
                    borderLeft: `1px solid ${isDark ? '#1e293b' : '#e5e7eb'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '-8px 0 30px rgba(0,0,0,0.15)',
                    animation: 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    overflow: 'hidden',
                }}
            >
                {/* Header */}
                <div style={{
                    padding: '24px 20px 20px',
                    borderBottom: `1px solid ${isDark ? '#1e293b' : '#f0f0f0'}`,
                    background: isDark
                        ? 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)'
                        : 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: isDark ? '#f1f5f9' : '#111827', margin: 0 }}>
                            Profile & Settings
                        </h2>
                        <button
                            onClick={onClose}
                            style={{
                                width: 32, height: 32, borderRadius: 8,
                                background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: isDark ? '#94a3b8' : '#6b7280',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)';
                                e.currentTarget.style.color = isDark ? '#f1f5f9' : '#111827';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
                                e.currentTarget.style.color = isDark ? '#94a3b8' : '#6b7280';
                            }}
                        >
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* User Avatar + Info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{
                            width: 56, height: 56, borderRadius: 16,
                            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 20, fontWeight: 700, color: '#fff',
                            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
                            flexShrink: 0,
                        }}>
                            {getInitials(user.name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{
                                fontSize: 16, fontWeight: 700,
                                color: isDark ? '#f1f5f9' : '#111827',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                                {user.name}
                            </div>
                            <div style={{
                                fontSize: 13,
                                color: isDark ? '#94a3b8' : '#6b7280',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                                {user.email}
                            </div>
                            <span style={{
                                display: 'inline-block', marginTop: 4,
                                padding: '2px 8px', borderRadius: 6,
                                fontSize: 11, fontWeight: 600,
                                background: isDark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.1)',
                                color: isDark ? '#a5b4fc' : '#4f46e5',
                                textTransform: 'capitalize',
                            }}>
                                {user.role}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Settings Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

                    {/* ===== DASHBOARD MODE SECTION ===== */}
                    <div style={{ marginBottom: 28 }}>
                        <div style={{
                            fontSize: 11, fontWeight: 700, color: isDark ? '#64748b' : '#9ca3af',
                            textTransform: 'uppercase', letterSpacing: '0.08em',
                            marginBottom: 12,
                        }}>
                            Dashboard Mode
                        </div>
                        <p style={{
                            fontSize: 12, color: isDark ? '#94a3b8' : '#6b7280',
                            marginBottom: 12, lineHeight: 1.5,
                        }}>
                            Choose which dashboard opens when you select a project.
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {/* NLP Mode Button */}
                            <button
                                onClick={() => setMode('nlp')}
                                style={{
                                    flex: 1, padding: '14px 12px', borderRadius: 12,
                                    border: mode === 'nlp'
                                        ? `2px solid ${isDark ? '#6366f1' : '#4f46e5'}`
                                        : `1.5px solid ${isDark ? '#334155' : '#e5e7eb'}`,
                                    background: mode === 'nlp'
                                        ? (isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)')
                                        : (isDark ? '#1e293b' : '#fafafa'),
                                    cursor: 'pointer', textAlign: 'center',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <div style={{ fontSize: 24, marginBottom: 6 }}>🧠</div>
                                <div style={{
                                    fontSize: 13, fontWeight: 700,
                                    color: mode === 'nlp'
                                        ? (isDark ? '#a5b4fc' : '#4f46e5')
                                        : (isDark ? '#94a3b8' : '#6b7280'),
                                }}>
                                    NLP Mode
                                </div>
                                <div style={{
                                    fontSize: 10, color: isDark ? '#64748b' : '#9ca3af',
                                    marginTop: 4,
                                }}>
                                    Natural Language Prompts
                                </div>
                                {mode === 'nlp' && (
                                    <div style={{
                                        marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                        fontSize: 10, fontWeight: 600,
                                        color: isDark ? '#22c55e' : '#16a34a',
                                    }}>
                                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Active
                                    </div>
                                )}
                            </button>

                            {/* Developer Mode Button */}
                            <button
                                onClick={() => setMode('developer')}
                                style={{
                                    flex: 1, padding: '14px 12px', borderRadius: 12,
                                    border: mode === 'developer'
                                        ? `2px solid ${isDark ? '#8b5cf6' : '#7c3aed'}`
                                        : `1.5px solid ${isDark ? '#334155' : '#e5e7eb'}`,
                                    background: mode === 'developer'
                                        ? (isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.08)')
                                        : (isDark ? '#1e293b' : '#fafafa'),
                                    cursor: 'pointer', textAlign: 'center',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <div style={{ fontSize: 24, marginBottom: 6 }}>💻</div>
                                <div style={{
                                    fontSize: 13, fontWeight: 700,
                                    color: mode === 'developer'
                                        ? (isDark ? '#c4b5fd' : '#7c3aed')
                                        : (isDark ? '#94a3b8' : '#6b7280'),
                                }}>
                                    Developer Mode
                                </div>
                                <div style={{
                                    fontSize: 10, color: isDark ? '#64748b' : '#9ca3af',
                                    marginTop: 4,
                                }}>
                                    Code-Level View
                                </div>
                                {mode === 'developer' && (
                                    <div style={{
                                        marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                        fontSize: 10, fontWeight: 600,
                                        color: isDark ? '#22c55e' : '#16a34a',
                                    }}>
                                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Active
                                    </div>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Divider */}
                    <div style={{ height: 1, background: isDark ? '#1e293b' : '#f0f0f0', margin: '0 0 28px' }} />

                    {/* ===== APPEARANCE SECTION ===== */}
                    <div style={{ marginBottom: 28 }}>
                        <div style={{
                            fontSize: 11, fontWeight: 700, color: isDark ? '#64748b' : '#9ca3af',
                            textTransform: 'uppercase', letterSpacing: '0.08em',
                            marginBottom: 12,
                        }}>
                            Appearance
                        </div>
                        <p style={{
                            fontSize: 12, color: isDark ? '#94a3b8' : '#6b7280',
                            marginBottom: 12, lineHeight: 1.5,
                        }}>
                            Choose between light and dark theme.
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {/* Light Mode */}
                            <button
                                onClick={() => setTheme('light')}
                                style={{
                                    flex: 1, padding: '14px 12px', borderRadius: 12,
                                    border: theme === 'light'
                                        ? `2px solid #f59e0b`
                                        : `1.5px solid ${isDark ? '#334155' : '#e5e7eb'}`,
                                    background: theme === 'light'
                                        ? (isDark ? 'rgba(245, 158, 11, 0.12)' : '#fffbeb')
                                        : (isDark ? '#1e293b' : '#fafafa'),
                                    cursor: 'pointer', textAlign: 'center',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <div style={{ fontSize: 28, marginBottom: 6 }}>☀️</div>
                                <div style={{
                                    fontSize: 13, fontWeight: 700,
                                    color: theme === 'light'
                                        ? '#d97706'
                                        : (isDark ? '#94a3b8' : '#6b7280'),
                                }}>
                                    Light
                                </div>
                                {theme === 'light' && (
                                    <div style={{
                                        marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                        fontSize: 10, fontWeight: 600,
                                        color: '#16a34a',
                                    }}>
                                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Active
                                    </div>
                                )}
                            </button>

                            {/* Dark Mode */}
                            <button
                                onClick={() => setTheme('dark')}
                                style={{
                                    flex: 1, padding: '14px 12px', borderRadius: 12,
                                    border: theme === 'dark'
                                        ? `2px solid #6366f1`
                                        : `1.5px solid ${isDark ? '#334155' : '#e5e7eb'}`,
                                    background: theme === 'dark'
                                        ? 'rgba(99, 102, 241, 0.12)'
                                        : (isDark ? '#1e293b' : '#fafafa'),
                                    cursor: 'pointer', textAlign: 'center',
                                    transition: 'all 0.2s ease',
                                }}
                            >
                                <div style={{ fontSize: 28, marginBottom: 6 }}>🌙</div>
                                <div style={{
                                    fontSize: 13, fontWeight: 700,
                                    color: theme === 'dark'
                                        ? '#818cf8'
                                        : (isDark ? '#94a3b8' : '#6b7280'),
                                }}>
                                    Dark
                                </div>
                                {theme === 'dark' && (
                                    <div style={{
                                        marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                        fontSize: 10, fontWeight: 600,
                                        color: '#22c55e',
                                    }}>
                                        <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                        </svg>
                                        Active
                                    </div>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Divider */}
                    <div style={{ height: 1, background: isDark ? '#1e293b' : '#f0f0f0', margin: '0 0 28px' }} />

                    {/* ===== ACCOUNT DETAILS SECTION ===== */}
                    <div style={{ marginBottom: 28 }}>
                        <div style={{
                            fontSize: 11, fontWeight: 700, color: isDark ? '#64748b' : '#9ca3af',
                            textTransform: 'uppercase', letterSpacing: '0.08em',
                            marginBottom: 12,
                        }}>
                            Account Details
                        </div>
                        <div style={{
                            borderRadius: 12,
                            border: `1px solid ${isDark ? '#1e293b' : '#f0f0f0'}`,
                            overflow: 'hidden',
                        }}>
                            {/* Name */}
                            <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '12px 16px',
                                borderBottom: `1px solid ${isDark ? '#1e293b' : '#f0f0f0'}`,
                            }}>
                                <span style={{ fontSize: 12, color: isDark ? '#64748b' : '#9ca3af', fontWeight: 500 }}>Name</span>
                                <span style={{ fontSize: 13, color: isDark ? '#f1f5f9' : '#111827', fontWeight: 600 }}>{user.name}</span>
                            </div>
                            {/* Email */}
                            <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '12px 16px',
                                borderBottom: `1px solid ${isDark ? '#1e293b' : '#f0f0f0'}`,
                            }}>
                                <span style={{ fontSize: 12, color: isDark ? '#64748b' : '#9ca3af', fontWeight: 500 }}>Email</span>
                                <span style={{ fontSize: 13, color: isDark ? '#f1f5f9' : '#111827', fontWeight: 500 }}>{user.email}</span>
                            </div>
                            {/* Role */}
                            <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '12px 16px',
                                borderBottom: `1px solid ${isDark ? '#1e293b' : '#f0f0f0'}`,
                            }}>
                                <span style={{ fontSize: 12, color: isDark ? '#64748b' : '#9ca3af', fontWeight: 500 }}>Role</span>
                                <span style={{
                                    fontSize: 12, fontWeight: 600,
                                    padding: '2px 10px', borderRadius: 6,
                                    background: isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)',
                                    color: isDark ? '#a5b4fc' : '#4f46e5',
                                    textTransform: 'capitalize',
                                }}>
                                    {user.role}
                                </span>
                            </div>
                            {/* Current Mode */}
                            <div style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '12px 16px',
                            }}>
                                <span style={{ fontSize: 12, color: isDark ? '#64748b' : '#9ca3af', fontWeight: 500 }}>Dashboard Mode</span>
                                <span style={{
                                    fontSize: 12, fontWeight: 600,
                                    padding: '2px 10px', borderRadius: 6,
                                    background: mode === 'nlp'
                                        ? (isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)')
                                        : (isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.1)'),
                                    color: mode === 'nlp'
                                        ? (isDark ? '#a5b4fc' : '#4f46e5')
                                        : (isDark ? '#c4b5fd' : '#7c3aed'),
                                    textTransform: 'capitalize',
                                }}>
                                    {mode === 'nlp' ? '🧠 NLP' : '💻 Developer'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer with Logout */}
                <div style={{
                    padding: '16px 20px',
                    borderTop: `1px solid ${isDark ? '#1e293b' : '#f0f0f0'}`,
                    background: isDark ? '#0c1222' : '#fafafa',
                }}>
                    <button
                        onClick={onLogout}
                        style={{
                            width: '100%', padding: '12px',
                            borderRadius: 10,
                            border: `1px solid ${isDark ? '#7f1d1d' : '#fecaca'}`,
                            background: isDark ? 'rgba(239, 68, 68, 0.1)' : '#fef2f2',
                            color: isDark ? '#fca5a5' : '#dc2626',
                            fontSize: 13, fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = isDark ? 'rgba(239, 68, 68, 0.2)' : '#fee2e2';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = isDark ? 'rgba(239, 68, 68, 0.1)' : '#fef2f2';
                        }}
                    >
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Sign Out
                    </button>
                </div>
            </div>
        </div>
    );
}
