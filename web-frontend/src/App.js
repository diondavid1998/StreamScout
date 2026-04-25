import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { parsePercent, ratingEntriesForItem, buildApiErrorMessage, getRottenTomatoesType } from './utils';
import streamscoutLogo from './logos/streamscout.png';

const API_BASE = process.env.REACT_APP_API_BASE || 'https://streamscore-backend-production.up.railway.app';
const AUTH_TOKEN_KEY = 'movieKnight.authToken';
const AUTH_USERNAME_KEY = 'movieKnight.username';
const BYPASS_MODE_KEY = 'movieKnight.bypassMode';
const PAGE_SIZE = 24;
const YEAR_RANGE_MIN = 1900;
const YEAR_RANGE_MAX = new Date().getFullYear();

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background:
      'radial-gradient(ellipse at 18% 0%, rgba(233,69,96,0.14) 0%, transparent 46%),' +
      'radial-gradient(ellipse at 84% 95%, rgba(80,108,220,0.09) 0%, transparent 46%),' +
      'linear-gradient(180deg, #0b0c11 0%, #0e1019 100%)',
    color: '#eef0f7',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, system-ui, sans-serif',
    WebkitFontSmoothing: 'antialiased',
    padding: '28px 16px 48px',
  },
  shell: {
    width: '100%',
    maxWidth: 1080,
    display: 'flex',
    justifyContent: 'center',
  },
  card: {
    background: 'linear-gradient(160deg, rgba(16,19,28,0.99) 0%, rgba(12,14,21,0.99) 100%)',
    borderRadius: 28,
    boxShadow: '0 40px 100px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.055)',
    padding: '36px 32px',
    width: '100%',
    maxWidth: 960,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    border: '1px solid rgba(255,255,255,0.065)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
  },
  authCard: {
    maxWidth: 420,
    padding: '48px 40px',
  },
  headerRow: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 28,
    flexWrap: 'wrap',
  },
  headingGroup: {
    textAlign: 'left',
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#e94560',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    margin: 0,
    fontSize: 30,
    fontWeight: 800,
    lineHeight: 1.06,
    letterSpacing: '-0.025em',
    background: 'linear-gradient(135deg, #ffffff 30%, rgba(200,210,235,0.8) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  subtitle: {
    margin: '9px 0 0',
    color: '#6e7a93',
    fontSize: 14,
    lineHeight: 1.55,
  },
  authMeta: {
    width: '100%',
    marginBottom: 32,
    textAlign: 'left',
  },
  form: {
    width: '100%',
  },
  input: {
    width: '100%',
    padding: '15px 16px',
    margin: '8px 0',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.1)',
    fontSize: 16,
    background: 'rgba(255,255,255,0.05)',
    color: '#eef0f7',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  },
  button: {
    width: '100%',
    padding: '15px 20px',
    margin: '12px 0 0',
    borderRadius: 14,
    border: 'none',
    background: 'linear-gradient(135deg, #e94560 0%, #c8304a 100%)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 16,
    cursor: 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '-0.01em',
    boxShadow: '0 8px 24px rgba(233,69,96,0.32), inset 0 1px 0 rgba(255,255,255,0.12)',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
  },
  buttonSecondary: {
    background: 'rgba(255,255,255,0.07)',
    boxShadow: 'none',
    border: '1px solid rgba(255,255,255,0.09)',
  },
  buttonSmall: {
    width: 'auto',
    padding: '9px 16px',
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 10,
  },
  buttonLoading: {
    opacity: 0.6,
    pointerEvents: 'none',
  },
  authSwitch: {
    marginTop: 20,
    color: '#6e7a93',
    fontSize: 14,
  },
  inlineButton: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: '#e94560',
    font: 'inherit',
    cursor: 'pointer',
    fontWeight: 600,
  },
  error: {
    width: '100%',
    background: 'rgba(233,69,96,0.1)',
    color: '#ff8fa3',
    marginTop: 16,
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 600,
    fontSize: 14,
    boxSizing: 'border-box',
    border: '1px solid rgba(233,69,96,0.2)',
  },
  info: {
    width: '100%',
    background: 'rgba(94,166,255,0.09)',
    color: '#90c4ff',
    marginTop: 16,
    borderRadius: 12,
    padding: '12px 16px',
    fontWeight: 500,
    fontSize: 14,
    boxSizing: 'border-box',
    border: '1px solid rgba(94,166,255,0.14)',
  },
  topActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'nowrap',
    alignItems: 'center',
    flexShrink: 0,
  },
  controlRow: {
    width: '100%',
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    marginBottom: 20,
  },
  dropdownGrid: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginBottom: 20,
  },
  dropdownPanel: {
    width: '100%',
    borderRadius: 16,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  dropdownSummary: {
    listStyle: 'none',
    cursor: 'pointer',
    padding: '13px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: '#c0c8d8',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    userSelect: 'none',
  },
  dropdownMeta: {
    color: '#6e7a93',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
  },
  dropdownBody: {
    padding: '4px 16px 16px',
  },
  serviceFilterRow: {
    width: '100%',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  controlGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flex: '1 1 150px',
  },
  controlLabel: {
    color: '#6e7a93',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  select: {
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: '#eef0f7',
    padding: '11px 14px',
    fontSize: 15,
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
    cursor: 'pointer',
  },
  catalogMeta: {
    width: '100%',
    color: '#6e7a93',
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 1.55,
    padding: '11px 16px',
    borderRadius: 13,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.05)',
  },
  platformGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))',
    gap: 14,
    width: '100%',
    marginBottom: 24,
    marginTop: 8,
  },
  platformCard: {
    width: '100%',
    minHeight: 108,
    borderRadius: 16,
    background: 'rgba(255,255,255,0.04)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1.5px solid rgba(255,255,255,0.07)',
    cursor: 'pointer',
    padding: '12px 8px',
    boxSizing: 'border-box',
    gap: 8,
  },
  platformCardSelected: {
    border: '1.5px solid rgba(233,69,96,0.65)',
    background: 'linear-gradient(160deg, rgba(233,69,96,0.14) 0%, rgba(180,30,54,0.09) 100%)',
    boxShadow: '0 8px 28px rgba(233,69,96,0.22), inset 0 1px 0 rgba(255,255,255,0.07)',
  },
  platformLabel: {
    textAlign: 'center',
    fontSize: 11,
    color: '#8a93a8',
    fontWeight: 600,
    userSelect: 'none',
    maxWidth: '100%',
    lineHeight: 1.3,
  },
  platformLogo: {
    width: 70,
    height: 70,
    objectFit: 'contain',
    objectPosition: 'center',
    display: 'block',
  },
  sectionActions: {
    width: '100%',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    flexWrap: 'wrap',
  },
  sectionBlock: {
    width: '100%',
    marginTop: 8,
    marginBottom: 20,
  },
  sectionLabel: {
    color: '#6e7a93',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  movieList: {
    width: '100%',
    display: 'grid',
    gap: 14,
  },
  movieCard: {
    background: 'linear-gradient(145deg, rgba(20,23,34,0.97) 0%, rgba(14,16,24,0.97) 100%)',
    borderRadius: 20,
    padding: '18px 20px',
    color: '#eef0f7',
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '108px minmax(0, 1fr)',
    gap: 18,
    boxSizing: 'border-box',
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.28)',
    position: 'relative',
    overflow: 'hidden',
  },
  moviePoster: {
    width: 108,
    height: 162,
    borderRadius: 14,
    objectFit: 'cover',
    background: 'rgba(255,255,255,0.04)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.38)',
    flexShrink: 0,
  },
  moviePosterPlaceholder: {
    width: 108,
    height: 162,
    borderRadius: 14,
    background: 'linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#3a4258',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    flexShrink: 0,
  },
  movieBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  movieTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 8,
    lineHeight: 1.18,
    letterSpacing: '-0.01em',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  movieSubhead: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 10,
  },
  chip: {
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 700,
    background: 'rgba(255,255,255,0.07)',
    color: '#b0bac8',
    letterSpacing: '0.02em',
  },
  chipAccent: {
    background: 'rgba(233,69,96,0.17)',
    color: '#ff8fa3',
    border: '1px solid rgba(233,69,96,0.25)',
  },
  chipTV: {
    background: 'rgba(94,166,255,0.17)',
    color: '#7db8ff',
    border: '1px solid rgba(94,166,255,0.22)',
  },
  chipMuted: {
    background: 'rgba(94,166,255,0.13)',
    color: '#90c4ff',
  },
  // Genre chips — purple accent
  chipGenre: {
    background: 'rgba(142,96,255,0.15)',
    color: '#c4a8ff',
    border: '1px solid rgba(142,96,255,0.3)',
    borderRadius: 8,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
  serviceFilterButton: {
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.05)',
    color: '#b0bac8',
    padding: '9px 14px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.02em',
    transition: 'all 0.18s ease',
  },
  serviceFilterButtonActive: {
    background: 'rgba(233,69,96,0.17)',
    border: '1px solid rgba(233,69,96,0.4)',
    color: '#ff8fa3',
  },
  genreFilterButtonActive: {
    background: 'rgba(142,96,255,0.2)',
    border: '1px solid rgba(142,96,255,0.45)',
    color: '#c4a8ff',
  },
  serviceLogoTiny: {
    width: 18,
    height: 18,
    objectFit: 'contain',
    display: 'block',
    flexShrink: 0,
  },
  movieOverview: {
    fontSize: 13,
    color: '#7a8499',
    marginBottom: 8,
    lineHeight: 1.62,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
  },
  ratingGrid: {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none',
    padding: '2px 0 4px',
    marginTop: 12,
  },
  ratingChip: {
    borderRadius: 12,
    padding: '9px 12px',
    background: 'rgba(255,255,255,0.05)',
    color: '#edf1f8',
    fontSize: 12,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid rgba(255,255,255,0.09)',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  ratingLogo: {
    width: 22,
    height: 22,
    objectFit: 'contain',
    flexShrink: 0,
  },
  ratingContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    lineHeight: 1.1,
  },
  ratingLabel: {
    fontSize: 9,
    color: '#6e7a93',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  ratingValue: {
    fontSize: 14,
    color: '#eef0f7',
    fontWeight: 700,
  },
  providerRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  providerChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.10)',
    color: '#c8d0e0',
    fontSize: 11,
    fontWeight: 600,
  },
  providerLogo: {
    width: 16,
    height: 16,
    objectFit: 'contain',
    display: 'block',
    flexShrink: 0,
  },
  movieDate: {
    fontSize: 12,
    color: '#e94560',
    fontWeight: 600,
  },
  emptyState: {
    color: '#6e7a93',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
    lineHeight: 1.5,
  },
  loadMoreWrap: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    marginTop: 24,
  },
  paginationRow: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
    flexWrap: 'wrap',
    marginTop: 24,
  },
  paginationSummary: {
    color: '#6e7a93',
    fontSize: 12,
    fontWeight: 600,
    marginRight: 4,
  },
  pageButton: {
    minWidth: 40,
    height: 40,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: '#c0c8d8',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.18s ease',
  },
  pageButtonActive: {
    background: 'linear-gradient(135deg, rgba(233,69,96,0.26), rgba(200,48,74,0.3))',
    border: '1px solid rgba(233,69,96,0.48)',
    color: '#fff',
  },
  // ── Rating chip color variants ─────────────────────────────────────────────
  ratingChipImdb: { border: '1px solid rgba(245,197,24,0.5)', background: 'rgba(245,197,24,0.1)' },
  ratingChipRT: { border: '1px solid rgba(250,70,70,0.45)', background: 'rgba(250,70,70,0.09)' },
  ratingChipRTRotten: { border: '1px solid rgba(140,140,160,0.3)', background: 'rgba(140,140,160,0.06)' },
  ratingChipMC: { border: '1px solid rgba(102,204,0,0.45)', background: 'rgba(102,204,0,0.09)' },
  ratingChipMCMid: { border: '1px solid rgba(255,193,7,0.45)', background: 'rgba(255,193,7,0.08)' },
  ratingChipMCLow: { border: '1px solid rgba(250,70,70,0.4)', background: 'rgba(250,70,70,0.08)' },
  ratingChipTMDb: { border: '1px solid rgba(1,210,119,0.35)', background: 'rgba(1,210,119,0.08)' },
  // ── Modal overlay ─────────────────────────────────────────────────────────
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    overflowY: 'auto',
  },
  modalCard: {
    background: 'linear-gradient(160deg, rgba(16,19,28,0.99) 0%, rgba(12,14,21,0.99) 100%)',
    borderRadius: 24, border: '1px solid rgba(255,255,255,0.09)',
    boxShadow: '0 40px 100px rgba(0,0,0,0.7)',
    maxWidth: 700, width: '100%', position: 'relative', overflow: 'hidden',
    maxHeight: '90vh', overflowY: 'auto', margin: 'auto',
  },
  modalClose: {
    position: 'absolute', top: 14, right: 14,
    background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.15)',
    color: '#fff', borderRadius: 999, width: 36, height: 36, display: 'flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    fontSize: 20, fontFamily: 'inherit', zIndex: 10, lineHeight: 1,
  },
  modalBanner: { width: '100%', height: 220, objectFit: 'cover', display: 'block' },
  modalBody: { padding: '22px 28px 32px' },
  modalPosterRow: { display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 16 },
  modalPoster: { width: 90, height: 136, borderRadius: 12, objectFit: 'cover', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', flexShrink: 0 },
  modalTitle: { fontSize: 24, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em', marginBottom: 6 },
  modalTagline: { fontSize: 13, color: '#6e7a93', fontStyle: 'italic', marginBottom: 10 },
  castRow: { display: 'flex', gap: 12, overflowX: 'auto', padding: '4px 0', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' },
  castCard: { flexShrink: 0, width: 72, textAlign: 'center' },
  castImg: { width: 56, height: 56, borderRadius: 999, objectFit: 'cover', background: 'rgba(255,255,255,0.06)', display: 'block', margin: '0 auto 5px', fontSize: 22, lineHeight: '56px' },
  castName: { fontSize: 10, color: '#c0c8d8', fontWeight: 600, lineHeight: 1.3 },
  castRole: { fontSize: 9, color: '#6e7a93', lineHeight: 1.2 },
  // ── Settings tabs ─────────────────────────────────────────────────────────
  settingsTabRow: { display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.08)', width: '100%' },
  settingsTabBtn: { padding: '10px 18px', background: 'none', border: 'none', color: '#6e7a93', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', borderBottom: '2px solid transparent', marginBottom: -1, transition: 'color 0.18s' },
  settingsTabBtnActive: { color: '#e94560', borderBottomColor: '#e94560' },
  // ── Watched button on card ────────────────────────────────────────────────
  watchedBtn: { position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', color: '#8a93a8', transition: 'all 0.18s ease' },
  watchedBtnActive: { background: 'rgba(1,210,119,0.22)', border: '1px solid rgba(1,210,119,0.45)', color: '#01d277' },
  // ── Watchlist in settings ─────────────────────────────────────────────────
  watchlistRow: { display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  watchlistPoster: { width: 40, height: 58, borderRadius: 8, objectFit: 'cover', background: 'rgba(255,255,255,0.05)', flexShrink: 0 },
  // ── Profile avatar ────────────────────────────────────────────────────────
  avatarCircle: { width: 80, height: 80, borderRadius: 999, background: 'rgba(233,69,96,0.15)', border: '2px solid rgba(233,69,96,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#e94560', overflow: 'hidden', flexShrink: 0 },
  // ── Year range inputs ─────────────────────────────────────────────────────
  yearRangeRow: { display: 'flex', gap: 10, alignItems: 'center' },
  yearRangeWrap: { padding: '4px 0 8px' },
  yearRangeLabels: { display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#c0c8d8', marginBottom: 10, fontVariantNumeric: 'tabular-nums' },
  yearRangeTrackWrap: { position: 'relative', height: 20, display: 'flex', alignItems: 'center' },
  // ── Clickable movie card ──────────────────────────────────────────────────
  movieCardClickable: { cursor: 'pointer' },
  // ── Filter panel (controlled, replaces <details>) ─────────────────────────
  filterPanel: { width: '100%', borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' },
  filterPanelHeader: { width: '100%', background: 'none', border: 'none', padding: '13px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#c0c8d8', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' },
};

const streamingPlatforms = [
  { key: 'netflix', name: 'Netflix', logo: require('./logos/netflix.png') },
  { key: 'hulu', name: 'Hulu', logo: require('./logos/hulu.jpeg') },
  { key: 'prime', name: 'Prime Video', logo: require('./logos/prime.png') },
  { key: 'disney', name: 'Disney+', logo: require('./logos/disney+.png') },
  { key: 'paramount', name: 'Paramount+', logo: require('./logos/paramount+.png') },
  { key: 'peacock', name: 'Peacock', logo: require('./logos/peacock.png') },
  { key: 'max', name: 'Max', logo: require('./logos/max.png') },
  { key: 'crunchyroll', name: 'Crunchyroll', logo: require('./logos/crunchyroll.png') },
];

const ratingLogos = {
  tmdb: require('./logos/tmdb.jpeg'),
  imdb: require('./logos/imdb.png'),
  metacritic: require('./logos/metacritic.jpeg'),
  rtMovieFresh: require('./logos/80%+_rt_movie.jpeg'),
  rtMovieCertified: require('./logos/90%+_rt_movie.png'),
  rtTvFresh: require('./logos/60%+_rt_tv.png'),
  rtRotten: require('./logos/60%-_rt_tv.jpeg'),
};

const languageOptions = [
  { key: 'en', name: 'English' },
  { key: 'es', name: 'Spanish' },
  { key: 'fr', name: 'French' },
  { key: 'de', name: 'German' },
  { key: 'it', name: 'Italian' },
  { key: 'pt', name: 'Portuguese' },
  { key: 'ja', name: 'Japanese' },
  { key: 'ko', name: 'Korean' },
  { key: 'hi', name: 'Hindi' },
  { key: 'zh', name: 'Mandarin' },
  { key: 'cn', name: 'Cantonese' },
  { key: 'ta', name: 'Tamil' },
  { key: 'te', name: 'Telugu' },
  { key: 'ml', name: 'Malayalam' },
];

function App() {
  const [page, setPage] = useState('login');
  const [authMode, setAuthMode] = useState('login');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selected, setSelected] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [movies, setMovies] = useState([]);
  const [catalogMeta, setCatalogMeta] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [loadingMovies, setLoadingMovies] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [mediaTypeFilter, setMediaTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('popularity');
  const [isBypassMode, setIsBypassMode] = useState(false);
  const [serviceFilters, setServiceFilters] = useState([]);
  const [languageFilters, setLanguageFilters] = useState([]);
  const [genreFilters, setGenreFilters] = useState([]);
  const [catalogPage, setCatalogPage] = useState(1);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showIosTip, setShowIosTip] = useState(false);
  const [platformSaveKey, setPlatformSaveKey] = useState(0);
  // ── New feature state ──────────────────────────────────────────────────────
  const [yearMin, setYearMin] = useState(YEAR_RANGE_MIN);
  const [yearMax, setYearMax] = useState(YEAR_RANGE_MAX);
  const [watchedIds, setWatchedIds] = useState(new Set());
  const [hideWatched, setHideWatched] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [movieDetails, setMovieDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [settingsTab, setSettingsTab] = useState('services');
  const [accountData, setAccountData] = useState({ username: '', email: '', profilePic: null });
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [watchlistItems, setWatchlistItems] = useState([]);
  const [watchlistOnlyItems, setWatchlistOnlyItems] = useState([]);
  const [watchlistIds, setWatchlistIds] = useState(new Set());
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [lbxFile, setLbxFile] = useState(null);
  const [lbxPreview, setLbxPreview] = useState(null);
  const [lbxProgress, setLbxProgress] = useState('');
  const [lbxDone, setLbxDone] = useState('');
  const [resetStep, setResetStep] = useState(0); // 0: off, 1: email, 2: code, 3: done
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPass, setResetNewPass] = useState('');
  const [openFilters, setOpenFilters] = useState({ service: false, language: false, genre: false, year: false });
  const [catalogStatus, setCatalogStatus] = useState(null);
  const abortRef = useRef(null);

  // buildApiErrorMessage imported from utils.js

  const clearFeedback = () => {
    setError('');
    setInfo('');
  };

  const clearSession = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USERNAME_KEY);
    localStorage.removeItem(BYPASS_MODE_KEY);
    setToken('');
    setMovies([]);
    setCatalogMeta(null);
    setSelected([]);
    setLanguages([]);
    setShowSettings(false);
    setPassword('');
    setIsBypassMode(false);
    setServiceFilters([]);
    setLanguageFilters([]);
    setCatalogPage(1);
    setYearMin(YEAR_RANGE_MIN);
    setYearMax(YEAR_RANGE_MAX);
    setWatchedIds(new Set());
    setHideWatched(false);
    setSelectedMovie(null);
    setMovieDetails(null);
    setSettingsTab('services');
    setAccountData({ username: '', email: '', profilePic: null });
    setWatchlistItems([]);
    setResetStep(0);
    setOpenFilters({ service: false, language: false, genre: false, year: false });
  };

  const logout = (message = 'You have been signed out.') => {
    clearSession();
    setPage('login');
    setAuthMode('login');
    setInfo(message);
  };

  const storeSession = (nextToken, nextUsername) => {
    localStorage.setItem(AUTH_TOKEN_KEY, nextToken);
    localStorage.setItem(AUTH_USERNAME_KEY, nextUsername);
    setToken(nextToken);
  };

  const parseResponseBody = async (response) => {
    const rawText = await response.text();

    if (!rawText) {
      return {};
    }

    try {
      return JSON.parse(rawText);
    } catch {
      return { error: rawText };
    }
  };

  const apiFetch = async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (response.status === 401 || response.status === 403) {
      logout('Your session expired. Sign in again.');
      throw new Error('Unauthorized');
    }

    return response;
  };

  const fetchPlatforms = async (jwt) => {
    const response = await fetch(`${API_BASE}/platforms`, {
      headers: { Authorization: `Bearer ${jwt || token}` },
    });

    if (response.status === 401 || response.status === 403) {
      logout('Your session expired. Sign in again.');
      return false;
    }

    const data = await parseResponseBody(response);

    if (!response.ok) {
      setError(buildApiErrorMessage(data, 'Failed to load your streaming platforms.'));
      return false;
    }

    setSelected(Array.isArray(data.platforms) ? data.platforms : []);
    setLanguages(Array.isArray(data.languages) ? data.languages : []);
    return true;
  };

  const loadWatched = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/watched`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await parseResponseBody(response);
      const items = Array.isArray(data.items) ? data.items : [];
      setWatchedIds(new Set(items.map((item) => item.item_id)));
      setWatchlistItems(items);
    } catch { /* silent */ }
  }, [token]); // eslint-disable-line

  const loadWatchlist = async () => {
    if (!token) return;
    try {
      const response = await apiFetch('/watchlist');
      if (!response.ok) return;
      const data = await parseResponseBody(response);
      const items = Array.isArray(data.items) ? data.items : [];
      setWatchlistOnlyItems(items);
      setWatchlistIds(new Set(items.map((item) => item.item_id)));
    } catch { /* silent */ }
  };

  const removeFromWatchlist = async (itemId) => {
    try {
      await apiFetch(`/watchlist/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
      setWatchlistOnlyItems((prev) => prev.filter((i) => i.item_id !== itemId));
      setWatchlistIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
    } catch { /* silent */ }
  };

  const handleLbxFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLbxFile(file);
    setLbxDone('');
    setLbxPreview(null);
    setLbxProgress('Parsing CSV…');
    try {
      const text = await file.text();
      const response = await apiFetch('/import/letterboxd/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: text, fileName: file.name }),
      });
      if (!response.ok) throw new Error('Preview failed');
      const data = await parseResponseBody(response);
      setLbxPreview(data);
      setLbxProgress('');
    } catch (err) {
      setLbxProgress('');
      setLbxDone('⚠ ' + (err.message || 'Failed to parse CSV'));
    }
  };

  const handleLbxImport = async () => {
    if (!lbxPreview || !lbxFile) return;
    const { items, importType } = lbxPreview;
    const batchSize = 50;
    let offset = 0;
    let totalMatched = 0;
    let totalNotFound = 0;
    const text = await lbxFile.text();
    // Re-parse items just in case (preview items already available)
    const allItems = items || [];
    setLbxPreview(null);
    while (offset < allItems.length) {
      const chunk = allItems.slice(offset, offset + batchSize);
      setLbxProgress(`Importing ${Math.min(offset + batchSize, allItems.length)} of ${allItems.length}…`);
      try {
        const response = await apiFetch('/import/letterboxd', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: chunk, importType }),
        });
        if (response.ok) {
          const data = await parseResponseBody(response);
          totalMatched += data.matched || 0;
          totalNotFound += data.notFound || 0;
        }
      } catch { break; }
      offset += batchSize;
    }
    // Refresh lists
    if (importType === 'watchlist') { await loadWatchlist(); }
    else { await loadWatched(); }
    setLbxProgress('');
    setLbxFile(null);
    setLbxDone(`✓ Imported ${totalMatched} of ${allItems.length} movies${totalNotFound > 0 ? ` (${totalNotFound} not found)` : ''}`);
  };

  const toggleWatched = async (movie) => {
    const itemId = movie.id;
    const isWatched = watchedIds.has(itemId);
    if (isWatched) {
      try {
        await apiFetch(`/watched/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        setWatchedIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
        setWatchlistItems((prev) => prev.filter((item) => item.item_id !== itemId));
      } catch { /* silent */ }
    } else {
      try {
        await apiFetch('/watched', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId, mediaType: movie.mediaType, title: movie.title, posterUrl: movie.posterUrl }),
        });
        setWatchedIds((prev) => new Set([...prev, itemId]));
        setWatchlistItems((prev) => [{ item_id: itemId, media_type: movie.mediaType, title: movie.title, poster_url: movie.posterUrl, watched_at: new Date().toISOString() }, ...prev]);
      } catch { /* silent */ }
    }
  };

  const fetchMovieDetails = async (movie) => {
    setSelectedMovie(movie);
    setMovieDetails(null);
    setLoadingDetails(true);
    try {
      const response = await apiFetch(`/titles/${movie.mediaType}/${movie.tmdbId}/details`);
      if (response.ok) {
        const data = await parseResponseBody(response);
        setMovieDetails(data);
      }
    } catch { /* silent */ }
    setLoadingDetails(false);
  };

  const fetchCatalogStatus = async () => {
    try {
      const response = await apiFetch('/catalog-status');
      if (!response.ok) return;
      const data = await parseResponseBody(response);
      setCatalogStatus(data);
    } catch { /* silent */ }
  };

  const fetchAccount = async () => {
    try {
      const response = await apiFetch('/account');
      if (!response.ok) return;
      const data = await parseResponseBody(response);
      setAccountData({ username: data.username || '', email: data.email || '', profilePic: data.profilePic || null });
      setEditUsername(data.username || '');
      setEditEmail(data.email || '');
    } catch { /* silent */ }
  };

  const handleUpdateAccount = async (e) => {
    e.preventDefault();
    clearFeedback();
    const updates = {};
    if (editUsername && editUsername !== accountData.username) updates.username = editUsername;
    if (editEmail !== accountData.email) updates.email = editEmail;
    if (editPassword) updates.password = editPassword;
    if (!Object.keys(updates).length) { setInfo('Nothing to update.'); return; }
    try {
      const response = await apiFetch('/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await parseResponseBody(response);
      if (!response.ok) { setError(buildApiErrorMessage(data, 'Update failed.')); return; }
      if (data.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        setToken(data.token);
        const newUsername = updates.username || username;
        localStorage.setItem(AUTH_USERNAME_KEY, newUsername);
        setUsername(newUsername);
      }
      setAccountData((prev) => ({ ...prev, ...(updates.username ? { username: updates.username } : {}), ...(updates.email !== undefined ? { email: updates.email } : {}) }));
      setEditPassword('');
      setInfo('Account updated.');
    } catch (err) { setError(`Network error: ${err.message}`); }
  };

  const handleProfilePicUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = async () => {
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 256, 256);
      const base64 = canvas.toDataURL('image/jpeg', 0.85);
      try {
        const response = await apiFetch('/account', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profilePic: base64 }),
        });
        if (response.ok) {
          setAccountData((prev) => ({ ...prev, profilePic: base64 }));
          setInfo('Profile picture updated.');
        }
      } catch { /* silent */ }
    };
    img.src = URL.createObjectURL(file);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    clearFeedback();
    try {
      const response = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail }),
      });
      const data = await parseResponseBody(response);
      if (!response.ok) { setError(buildApiErrorMessage(data, 'Failed to send reset code.')); return; }
      setResetStep(2);
      setInfo('If that email is registered, a 6-digit code has been sent.');
    } catch (err) { setError(`Network error: ${err.message}`); }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    clearFeedback();
    try {
      const response = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, code: resetCode, newPassword: resetNewPass }),
      });
      const data = await parseResponseBody(response);
      if (!response.ok) { setError(buildApiErrorMessage(data, 'Reset failed.')); return; }
      setResetStep(0);
      setInfo('Password reset. Sign in with your new password.');
    } catch (err) { setError(`Network error: ${err.message}`); }
  };

  const getRatingChipStyle = (key, value) => {
    if (key === 'imdb') return styles.ratingChipImdb;
    if (key === 'tmdb') return styles.ratingChipTMDb;
    if (key === 'rottenTomatoes') {
      const pct = parsePercent(value);
      return (pct !== null && pct >= 60) ? styles.ratingChipRT : styles.ratingChipRTRotten;
    }
    if (key === 'metacritic') {
      const num = parseInt(value);
      if (!isNaN(num)) {
        if (num >= 61) return styles.ratingChipMC;
        if (num >= 40) return styles.ratingChipMCMid;
        return styles.ratingChipMCLow;
      }
    }
    return {};
  };

  const toggleFilterPanel = (key) => setOpenFilters((prev) => ({ ...prev, [key]: !prev[key] }));

  const fetchMovies = useCallback(async () => {
    if (isBypassMode) {
      setMovies([]);
      setCatalogMeta(null);
      setError('');
      setInfo('Tester mode is active. Sign in with a real account to load the live catalog.');
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingMovies(true);
    setError('');
    setInfo('');

    try {
      const query = new URLSearchParams({
        mediaType: mediaTypeFilter,
        sortBy,
        limit: String(PAGE_SIZE),
        region: 'US',
        page: String(catalogPage),
      });

      if (serviceFilters.length) {
        query.set('serviceFilters', serviceFilters.join(','));
      }

      if (languageFilters.length) {
        query.set('languageFilters', languageFilters.join(','));
      }

      if (genreFilters.length) {
        query.set('genreFilters', genreFilters.join(','));
      }

      if (yearMin !== YEAR_RANGE_MIN) query.set('yearMin', yearMin);
      if (yearMax !== YEAR_RANGE_MAX) query.set('yearMax', yearMax);
      if (hideWatched) query.set('hideWatched', 'true');
      if (watchlistOnly && watchlistIds.size > 0) query.set('watchlistOnly', 'true');

      const response = await apiFetch(`/movies?${query.toString()}`, {
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await parseResponseBody(response);

      if (!response.ok) {
        setError(buildApiErrorMessage(data, 'Failed to fetch movies.'));
        return;
      }

      const items = Array.isArray(data.items) ? data.items : [];
      setMovies(items);
      setCatalogMeta(data.meta || null);
      if (!items.length) {
        setInfo(
          serviceFilters.length || languageFilters.length || genreFilters.length || yearMin !== YEAR_RANGE_MIN || yearMax !== YEAR_RANGE_MAX
            ? 'No titles matched the current catalog filters.'
            : 'No titles were returned for the platforms currently selected.'
        );
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err.message !== 'Unauthorized') {
        setError(`Network error: ${err.message}. Make sure the backend is running at ${API_BASE}.`);
      }
    } finally {
      setLoadingMovies(false);
    }
  }, [isBypassMode, mediaTypeFilter, sortBy, catalogPage, serviceFilters, languageFilters, genreFilters, yearMin, yearMax, hideWatched, token, platformSaveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatMediaType = (value) => {
    if (value === 'documentary') {
      return 'Documentary';
    }

    if (value === 'tv') {
      return 'TV';
    }

    if (value === 'movie') {
      return 'Movie';
    }

    return value;
  };

  const providerNameToPlatform = useMemo(
    () => Object.fromEntries(streamingPlatforms.map((platform) => [platform.name, platform])),
    []
  );

  const toggleServiceFilter = (serviceKey) => {
    setCatalogPage(1);
    setServiceFilters((current) =>
      current.includes(serviceKey)
        ? current.filter((value) => value !== serviceKey)
        : [...current, serviceKey]
    );
  };

  const toggleLanguage = (languageKey) => {
    setLanguages((current) =>
      current.includes(languageKey)
        ? current.filter((value) => value !== languageKey)
        : [...current, languageKey]
    );
  };

  const toggleLanguageFilter = (languageKey) => {
    setCatalogPage(1);
    setLanguageFilters((current) =>
      current.includes(languageKey)
        ? current.filter((value) => value !== languageKey)
        : [...current, languageKey]
    );
  };

  const toggleGenreFilter = (genreKey) => {
    setCatalogPage(1);
    setGenreFilters((current) =>
      current.includes(genreKey)
        ? current.filter((value) => value !== genreKey)
        : [...current, genreKey]
    );
  };

  const ALL_GENRES = [
    { key: 'Action', label: 'Action' },
    { key: 'Adventure', label: 'Adventure' },
    { key: 'Animation', label: 'Animation' },
    { key: 'anime', label: '✦ Anime' },
    { key: 'Comedy', label: 'Comedy' },
    { key: 'Crime', label: 'Crime' },
    { key: 'Documentary', label: 'Documentary' },
    { key: 'Drama', label: 'Drama' },
    { key: 'Fantasy', label: 'Fantasy' },
    { key: 'Horror', label: 'Horror' },
    { key: 'Mystery', label: 'Mystery' },
    { key: 'Romance', label: 'Romance' },
    { key: 'Science Fiction', label: 'Sci-Fi' },
    { key: 'Thriller', label: 'Thriller' },
    { key: 'Western', label: 'Western' },
  ];

  const totalPages = useMemo(() => Math.max(catalogMeta?.totalPages || 1, 1), [catalogMeta]);
  const pageNumbers = useMemo(
    () => Array.from({ length: Math.min(totalPages, 7) }, (_, index) => {
      if (totalPages <= 7) return index + 1;
      const start = Math.max(1, Math.min(catalogPage - 3, totalPages - 6));
      return start + index;
    }),
    [totalPages, catalogPage]
  );

  // parsePercent, ratingEntriesForItem imported from utils.js

  const getRottenTomatoesCriticsLogo = (item) => {
    const type = getRottenTomatoesType(parsePercent(item?.ratings?.rottenTomatoes), item?.mediaType);
    if (!type) return null;
    if (type === 'rotten') return ratingLogos.rtRotten;
    if (type === 'certified') return ratingLogos.rtMovieCertified;
    if (type === 'fresh-movie') return ratingLogos.rtMovieFresh;
    return ratingLogos.rtTvFresh;
  };

  const getRatingVisual = (item, key) => {
    if (key === 'tmdb') {
      return ratingLogos.tmdb;
    }

    if (key === 'imdb') {
      return ratingLogos.imdb;
    }

    if (key === 'rottenTomatoes') {
      return getRottenTomatoesCriticsLogo(item);
    }

    if (key === 'metacritic') {
      return ratingLogos.metacritic;
    }

    return null;
  };

  // ratingEntriesForItem imported from utils.js

  useEffect(() => {
    const restoreSession = async () => {
      const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
      const storedUsername = localStorage.getItem(AUTH_USERNAME_KEY);
      const bypassMode = localStorage.getItem(BYPASS_MODE_KEY) === 'true';

      if (bypassMode) {
        setIsBypassMode(true);
        setUsername(storedUsername || 'tester');
        setPage('platforms');
        setInfo('Tester mode is active.');
        setLoadingSession(false);
        return;
      }

      if (!storedToken) {
        setLoadingSession(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/platforms`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        });

        if (response.status === 401 || response.status === 403) {
          clearSession();
          setPage('login');
          setAuthMode('login');
          setInfo('Your session expired. Sign in again.');
          return;
        }

        const data = await parseResponseBody(response);

        if (!response.ok) {
          setError(buildApiErrorMessage(data, 'Failed to restore your account.'));
          return;
        }

        setToken(storedToken);
        setUsername(storedUsername || '');
        setSelected(Array.isArray(data.platforms) ? data.platforms : []);
        setLanguages(Array.isArray(data.languages) ? data.languages : []);
        setPage('platforms');
        setInfo(`Signed in as ${storedUsername || 'your account'}.`);
      } catch (err) {
        setError(`Network error: ${err.message}. Make sure the backend is running at ${API_BASE}.`);
      } finally {
        setLoadingSession(false);
      }
    };

    restoreSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Single effect: fetch movies whenever the page is movies OR any filter/sort/page changes
  useEffect(() => {
    if (page === 'movies') {
      fetchMovies();
    }
  }, [page, fetchMovies]);

  // Load watched list when on catalog page
  useEffect(() => {
    if (page === 'movies' && token) {
      loadWatched();
      loadWatchlist();
    }
  }, [page, token]); // eslint-disable-line

  // Load account data + watchlist when switching settings tabs
  useEffect(() => {
    if (!showSettings) return;
    if (settingsTab === 'profile') fetchAccount();
    if (settingsTab === 'services') fetchCatalogStatus();
    if (settingsTab === 'watchlist') { loadWatched(); loadWatchlist(); }
  }, [settingsTab, showSettings]); // eslint-disable-line

  // Auto-retry when the backend is still warming up the catalog cache
  useEffect(() => {
    if (!catalogMeta?.refreshing || page !== 'movies' || loadingMovies) return;
    const timer = setTimeout(() => fetchMovies(), 8000);
    return () => clearTimeout(timer);
  }, [catalogMeta, page, loadingMovies, fetchMovies]);

  useEffect(() => {
    setServiceFilters((current) => current.filter((key) => selected.includes(key)));
  }, [selected]);

  useEffect(() => {
    setLanguageFilters((current) => current.filter((key) => languages.includes(key)));
  }, [languages]);

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isIos && !isInStandaloneMode) {
      setShowIosTip(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    clearFeedback();

    const cleanUsername = username.trim();
    if (!cleanUsername || !password) {
      setError('Enter both a username and password.');
      return;
    }

    setLoadingAuth(true);

    try {
      const response = await fetch(`${API_BASE}/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUsername,
          password,
          ...(authMode === 'register' && resetEmail ? { email: resetEmail } : {}),
        }),
      });
      const data = await parseResponseBody(response);

      if (!response.ok || !data.token) {
        setError(buildApiErrorMessage(data, `Unable to ${authMode}.`));
        return;
      }

      storeSession(data.token, cleanUsername);
      setUsername(cleanUsername);
      setPassword('');
      setPage('platforms');
      setAuthMode('login');

      const restored = await fetchPlatforms(data.token);
      if (restored) {
        setInfo(authMode === 'register' ? 'Account created. Choose your services.' : 'Signed in successfully.');
      }
    } catch (err) {
      setError(`Network error: ${err.message}. Make sure the backend is running at ${API_BASE}.`);
    } finally {
      setLoadingAuth(false);
      setLoadingSession(false);
    }
  };

  const handleBypassLogin = async () => {
    clearFeedback();

    const bypassUsername = username.trim() || 'tester';
    localStorage.setItem(AUTH_USERNAME_KEY, bypassUsername);
    localStorage.setItem(BYPASS_MODE_KEY, 'true');
    setToken('');
    setIsBypassMode(true);
    setUsername(bypassUsername);
    setPassword('');
    setPage('platforms');
    setSelected([]);
    setMovies([]);
    setCatalogMeta(null);
    setInfo(`Tester mode enabled for ${bypassUsername}.`);
  };

  const handleSavePlatforms = async () => {
    clearFeedback();

    if (isBypassMode) {
      setPage('movies');
      setShowSettings(false);
      setMovies([]);
      setCatalogMeta(null);
      setCatalogPage(1);
      setInfo('Tester mode active. You skipped login, so live catalog data is disabled until you sign in.');
      return;
    }

    try {
      const response = await apiFetch('/platforms', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ platforms: selected, languages }),
      });
      const data = await parseResponseBody(response);

      if (!response.ok || !data.success) {
        setError(buildApiErrorMessage(data, 'Failed to save platforms.'));
        return;
      }

      setPage('movies');
      setShowSettings(false);
      setCatalogPage(1);
      setInfo('Platforms saved.');
      setPlatformSaveKey((k) => k + 1);
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        setError(`Network error: ${err.message}. Make sure the backend is running at ${API_BASE}.`);
      }
    }
  };

  const renderFeedback = () => (
    <>
      {error ? <div style={styles.error}>{error}</div> : null}
      {!error && info ? <div style={styles.info}>{info}</div> : null}
    </>
  );

  const renderPlatformSelector = () => (
    <div style={styles.platformGrid} className="platform-grid-wrap">
      {streamingPlatforms.map((platform) => {
        const isSelected = selected.includes(platform.key);

        return (
          <div key={platform.key}>
            <input
              type="checkbox"
              id={`platform-${platform.key}`}
              checked={isSelected}
              onChange={(event) => {
                if (event.target.checked) {
                  setSelected((current) => [...current, platform.key]);
                } else {
                  setSelected((current) => current.filter((value) => value !== platform.key));
                }
              }}
              style={{ display: 'none' }}
            />
            <label
              htmlFor={`platform-${platform.key}`}
              className="platform-tile"
              style={{
                ...styles.platformCard,
                ...(isSelected ? styles.platformCardSelected : {}),
              }}
            >
              <img src={platform.logo} alt={platform.name} style={styles.platformLogo} className="platform-tile-logo" />
              <span style={styles.platformLabel} className="platform-tile-label">{platform.name}</span>
            </label>
          </div>
        );
      })}
    </div>
  );

  if (loadingSession) {
    return (
      <div style={styles.container} className="mk-container">
        <div style={{ ...styles.card, ...styles.authCard }} className="mk-card mk-card-auth">
          <div style={styles.authMeta}>
            <img src={streamscoutLogo} alt="StreamScout" style={{ width: 56, height: 56, borderRadius: 14, marginBottom: 12 }} />
            <h1 style={styles.title}>Restoring session</h1>
            <p style={styles.subtitle}>Checking your saved sign-in state…</p>
          </div>
        </div>
      </div>
    );
  }

  if (page === 'login') {
    const isRegister = authMode === 'register';

    // Forgot password flow
    if (resetStep === 1) {
      return (
        <div style={styles.container} className="mk-container">
          <div style={styles.shell} className="mk-shell">
            <div style={{ ...styles.card, ...styles.authCard }} className="mk-card mk-card-auth fade-in">
              <div style={styles.authMeta}>
                <img src={streamscoutLogo} alt="StreamScout" style={{ width: 48, height: 48, borderRadius: 12, marginBottom: 10 }} />
                <h1 style={styles.title}>Reset Password</h1>
                <p style={styles.subtitle}>Enter the email address on your account. We'll send a 6-digit code.</p>
              </div>
              <form onSubmit={handleForgotPassword} style={styles.form}>
                <input
                  style={styles.input} className="mk-input" type="email" placeholder="Email address"
                  value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} autoComplete="email"
                />
                <button style={styles.button} className="btn-tap" type="submit">Send Reset Code</button>
              </form>
              <div style={styles.authSwitch}>
                <button style={styles.inlineButton} type="button" onClick={() => { setResetStep(0); clearFeedback(); }}>← Back to Sign In</button>
              </div>
              {renderFeedback()}
            </div>
          </div>
        </div>
      );
    }

    if (resetStep === 2) {
      return (
        <div style={styles.container} className="mk-container">
          <div style={styles.shell} className="mk-shell">
            <div style={{ ...styles.card, ...styles.authCard }} className="mk-card mk-card-auth fade-in">
              <div style={styles.authMeta}>
                <img src={streamscoutLogo} alt="StreamScout" style={{ width: 48, height: 48, borderRadius: 12, marginBottom: 10 }} />
                <h1 style={styles.title}>Enter Code</h1>
                <p style={styles.subtitle}>Enter the 6-digit code sent to <strong>{resetEmail}</strong> and choose a new password.</p>
              </div>
              <form onSubmit={handleResetPassword} style={styles.form}>
                <input
                  style={styles.input} className="mk-input" placeholder="6-digit code"
                  value={resetCode} onChange={(e) => setResetCode(e.target.value)} autoComplete="one-time-code"
                  inputMode="numeric"
                />
                <input
                  style={styles.input} className="mk-input" type="password" placeholder="New password"
                  value={resetNewPass} onChange={(e) => setResetNewPass(e.target.value)} autoComplete="new-password"
                />
                <button style={styles.button} className="btn-tap" type="submit">Reset Password</button>
              </form>
              <div style={styles.authSwitch}>
                <button style={styles.inlineButton} type="button" onClick={() => { setResetStep(1); clearFeedback(); }}>← Re-send code</button>
              </div>
              {renderFeedback()}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={styles.container} className="mk-container">
        <div style={styles.shell} className="mk-shell">
          <div style={{ ...styles.card, ...styles.authCard }} className="mk-card mk-card-auth fade-in">
            <div style={styles.authMeta}>
              <img src={streamscoutLogo} alt="StreamScout" style={{ width: 56, height: 56, borderRadius: 14, marginBottom: 12 }} />
              <div style={styles.eyebrow}>StreamScout</div>
              <h1 style={styles.title}>{isRegister ? 'Create your account' : 'Sign in'}</h1>
              <p style={styles.subtitle}>
                {isRegister
                  ? 'Register once, save your streaming services, and get personalised picks.'
                  : 'Use your account to manage platforms and browse the live catalog.'}
              </p>
            </div>

            <form onSubmit={handleAuth} style={styles.form}>
              <input
                style={styles.input} className="mk-input" placeholder="Username"
                value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username"
              />
              {isRegister && (
                <input
                  style={styles.input} className="mk-input" type="email" placeholder="Email (optional — for password reset)"
                  value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} autoComplete="email"
                />
              )}
              <input
                style={styles.input} className="mk-input" placeholder="Password" type="password"
                value={password} onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
              <button
                style={{ ...styles.button, ...(loadingAuth ? styles.buttonLoading : {}) }}
                className="btn-tap" type="submit" disabled={loadingAuth}
              >
                {loadingAuth ? 'Working…' : isRegister ? 'Create Account' : 'Sign In'}
              </button>
              {!isRegister ? (
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary }}
                  className="btn-tap" onClick={handleBypassLogin} type="button"
                >
                  Bypass for Testing
                </button>
              ) : null}
            </form>

            {!isRegister && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <button
                  style={styles.inlineButton} type="button"
                  onClick={() => { clearFeedback(); setResetStep(1); }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            <div style={styles.authSwitch}>
              {isRegister ? 'Already have an account? ' : 'Need an account? '}
              <button
                style={styles.inlineButton}
                onClick={() => { clearFeedback(); setAuthMode(isRegister ? 'login' : 'register'); }}
                type="button"
              >
                {isRegister ? 'Sign in instead' : 'Create one'}
              </button>
            </div>

            {renderFeedback()}
          </div>
        </div>
      </div>
    );
  }

  if (showSettings || page === 'platforms') {
    const isFirstSetup = page === 'platforms' && !showSettings;
    return (
      <div style={styles.container} className="mk-container">
        <div style={styles.shell} className="mk-shell">
          <div style={styles.card} className="mk-card fade-in">
            <div style={styles.headerRow} className="header-row-wrap">
              <div style={styles.headingGroup}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <img src={streamscoutLogo} alt="StreamScout" style={{ width: 36, height: 36, borderRadius: 9 }} />
                  <div style={styles.eyebrow}>StreamScout</div>
                </div>
                <h1 style={styles.title}>{isFirstSetup ? 'Choose your platforms' : 'Settings'}</h1>
                <p style={styles.subtitle}>Signed in as <strong>{username || 'your account'}</strong></p>
              </div>
              <div style={styles.topActions} className="top-actions-wrap">
                {!isFirstSetup && (
                  <button style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }} className="btn-tap"
                    onClick={() => { setShowSettings(false); setPage('movies'); clearFeedback(); }} type="button">← Back</button>
                )}
                <button style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }} className="btn-tap"
                  onClick={() => logout()} type="button">Logout</button>
              </div>
            </div>

            {!isFirstSetup && (
              <div style={styles.settingsTabRow}>
                {[['services', '⚙ Services'], ['profile', '👤 Profile'], ['watchlist', '✓ Watchlist']].map(([tab, label]) => (
                  <button key={tab} type="button"
                    style={{ ...styles.settingsTabBtn, ...(settingsTab === tab ? styles.settingsTabBtnActive : {}) }}
                    onClick={() => { setSettingsTab(tab); clearFeedback(); }}>{label}</button>
                ))}
              </div>
            )}

            {/* ── Services Tab ── */}
            {(isFirstSetup || settingsTab === 'services') && (
              <>
                <div style={styles.dropdownGrid} className="dropdown-grid-wrap">
                  <details style={styles.dropdownPanel} open>
                    <summary style={styles.dropdownSummary}>
                      <span>Streaming Services</span>
                      <span style={styles.dropdownMeta}>{selected.length} selected</span>
                    </summary>
                    <div style={styles.dropdownBody}>{renderPlatformSelector()}</div>
                  </details>
                  <details style={styles.dropdownPanel} open>
                    <summary style={styles.dropdownSummary}>
                      <span>Languages</span>
                      <span style={styles.dropdownMeta}>{languages.length} selected</span>
                    </summary>
                    <div style={styles.dropdownBody}>
                      <div style={styles.serviceFilterRow}>
                        {languageOptions.map((language) => {
                          const isActive = languages.includes(language.key);
                          return (
                            <button key={language.key} type="button" onClick={() => toggleLanguage(language.key)}
                              className="btn-tap"
                              style={{ ...styles.serviceFilterButton, ...(isActive ? styles.serviceFilterButtonActive : {}) }}>
                              <span>{language.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                </div>
                <div style={styles.sectionActions}>
                  <button style={styles.button} className="btn-tap" onClick={handleSavePlatforms} type="button">
                    {isFirstSetup ? 'Save and Continue →' : 'Save Changes'}
                  </button>
                </div>
                {!isFirstSetup && catalogStatus && (
                  <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', fontSize: 12, color: '#6e7a93' }}>
                    🗄 Catalog last refreshed:{' '}
                    <span style={{ color: '#c0c8d8' }}>
                      {catalogStatus.lastSyncedAt
                        ? new Date(catalogStatus.lastSyncedAt).toLocaleString()
                        : 'Not yet synced'}
                    </span>
                    {catalogStatus.itemCount > 0 && (
                      <span style={{ marginLeft: 8, color: '#8a93a8' }}>· {catalogStatus.itemCount.toLocaleString()} titles</span>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── Profile Tab ── */}
            {!isFirstSetup && settingsTab === 'profile' && (
              <form onSubmit={handleUpdateAccount} style={{ width: '100%' }}>
                {/* Avatar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                  <div style={styles.avatarCircle}>
                    {accountData.profilePic
                      ? <img src={accountData.profilePic} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span>{(accountData.username || username || '?')[0].toUpperCase()}</span>}
                  </div>
                  <div>
                    <div style={{ color: '#c0c8d8', fontWeight: 700, marginBottom: 6 }}>{accountData.username || username}</div>
                    <label style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall, display: 'inline-block', cursor: 'pointer' }}>
                      Upload Photo
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleProfilePicUpload} />
                    </label>
                  </div>
                </div>
                <div style={styles.sectionBlock}>
                  <div style={styles.sectionLabel}>Username</div>
                  <input style={styles.input} className="mk-input" placeholder="New username"
                    value={editUsername} onChange={(e) => setEditUsername(e.target.value)} autoComplete="username" />
                </div>
                <div style={styles.sectionBlock}>
                  <div style={styles.sectionLabel}>Email</div>
                  <input style={styles.input} className="mk-input" type="email" placeholder="Email address (for password reset)"
                    value={editEmail} onChange={(e) => setEditEmail(e.target.value)} autoComplete="email" />
                </div>
                <div style={styles.sectionBlock}>
                  <div style={styles.sectionLabel}>New Password</div>
                  <input style={styles.input} className="mk-input" type="password" placeholder="Leave blank to keep current"
                    value={editPassword} onChange={(e) => setEditPassword(e.target.value)} autoComplete="new-password" />
                </div>
                <div style={styles.sectionActions}>
                  <button style={styles.button} className="btn-tap" type="submit">Save Profile</button>
                </div>

                {/* Letterboxd Import */}
                <div style={{ marginTop: 28, padding: '20px', background: 'rgba(108,99,255,0.08)', borderRadius: 12, border: '1px solid rgba(108,99,255,0.25)' }}>
                  <div style={{ fontWeight: 700, color: '#8b82ff', fontSize: 14, marginBottom: 6 }}>📦 Import from Letterboxd</div>
                  <div style={{ color: '#6e7a93', fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
                    Export your diary or watchlist from Letterboxd (letterboxd.com/settings/data), then upload the CSV here.
                  </div>
                  {!lbxPreview && !lbxProgress && (
                    <label style={{ ...styles.button, ...styles.buttonSecondary, display: 'inline-block', cursor: 'pointer', fontSize: 13 }}>
                      Choose CSV file
                      <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleLbxFileChange} />
                    </label>
                  )}
                  {lbxProgress && <div style={{ color: '#c0c8d8', fontSize: 13, marginTop: 8 }}>{lbxProgress}</div>}
                  {lbxDone && <div style={{ color: lbxDone.startsWith('✓') ? '#01d277' : '#e94560', fontSize: 13, marginTop: 8 }}>{lbxDone}</div>}
                  {lbxPreview && !lbxProgress && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ color: '#c0c8d8', fontSize: 13, marginBottom: 12 }}>
                        Found <strong style={{ color: '#eef0f7' }}>{lbxPreview.count}</strong> {lbxPreview.importType === 'watchlist' ? 'watchlist items' : 'watched movies'} to import.
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button type="button" style={{ ...styles.button, fontSize: 13 }} onClick={handleLbxImport}>
                          Import all
                        </button>
                        <button type="button" style={{ ...styles.button, ...styles.buttonSecondary, fontSize: 13 }} onClick={() => { setLbxPreview(null); setLbxFile(null); }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </form>
            )}

            {/* ── Watchlist Tab ── */}
            {!isFirstSetup && settingsTab === 'watchlist' && (
              <div style={{ width: '100%' }}>
                {/* Watched section */}
                <div style={{ fontWeight: 700, color: '#01d277', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  ✓ Watched ({watchlistItems.length})
                </div>
                {watchlistItems.length === 0
                  ? <p style={{ ...styles.emptyState, marginBottom: 16 }}>No watched content yet.</p>
                  : watchlistItems.map((item) => (
                    <div key={item.item_id} style={styles.watchlistRow}>
                      {item.poster_url
                        ? <img src={item.poster_url} alt={item.title} style={styles.watchlistPoster} />
                        : <div style={{ ...styles.watchlistPoster, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎬</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#eef0f7', marginBottom: 2 }}>{item.title || item.item_id}</div>
                        <div style={{ fontSize: 11, color: '#6e7a93', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{item.media_type || ''}</div>
                      </div>
                      <button type="button"
                        style={{ background: 'none', border: 'none', color: '#e94560', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '6px 10px' }}
                        onClick={() => toggleWatched({ id: item.item_id, mediaType: item.media_type, title: item.title, posterUrl: item.poster_url })}>
                        Remove
                      </button>
                    </div>
                  ))}

                {/* Letterboxd Watchlist section */}
                <div style={{ fontWeight: 700, color: '#8b82ff', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 24, marginBottom: 10 }}>
                  🔖 Letterboxd Watchlist ({watchlistOnlyItems.length})
                </div>
                {watchlistOnlyItems.length === 0
                  ? <p style={styles.emptyState}>No watchlist items. Import from Letterboxd in the Profile tab.</p>
                  : watchlistOnlyItems.map((item) => (
                    <div key={item.item_id} style={styles.watchlistRow}>
                      {item.poster_url
                        ? <img src={item.poster_url} alt={item.title} style={styles.watchlistPoster} />
                        : <div style={{ ...styles.watchlistPoster, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🔖</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#eef0f7', marginBottom: 2 }}>{item.title || item.item_id}</div>
                        <div style={{ fontSize: 11, color: '#6e7a93', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{item.media_type || ''}</div>
                      </div>
                      <button type="button"
                        style={{ background: 'none', border: 'none', color: '#e94560', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '6px 10px' }}
                        onClick={() => removeFromWatchlist(item.item_id)}>
                        Remove
                      </button>
                    </div>
                  ))}
              </div>
            )}

            {renderFeedback()}
          </div>
        </div>
      </div>
    );
  }

  if (page === 'movies') {
    const renderFilterPanel = (key, label, metaText, children) => (
      <div style={styles.filterPanel} key={key}>
        <button type="button" style={styles.filterPanelHeader} onClick={() => toggleFilterPanel(key)}>
          <span>{label}</span>
          <span style={{ ...styles.dropdownMeta, display: 'flex', alignItems: 'center', gap: 6 }}>
            {metaText}
            <span style={{ fontSize: 10 }}>{openFilters[key] ? '▲' : '▼'}</span>
          </span>
        </button>
        {openFilters[key] && <div style={styles.dropdownBody}>{children}</div>}
      </div>
    );

    return (
      <div style={styles.container} className="mk-container">
        <div style={styles.shell} className="mk-shell">
          <div style={styles.card} className="mk-card fade-in">
            <div style={styles.headerRow} className="header-row-wrap">
              <div style={styles.headingGroup}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <img src={streamscoutLogo} alt="StreamScout" style={{ width: 32, height: 32, borderRadius: 8 }} />
                  <div style={styles.eyebrow}>🎬 Catalog</div>
                </div>
                <h1 style={styles.title}>StreamScout</h1>
                <p style={styles.subtitle}>Live movies &amp; TV from your selected streaming services.</p>
              </div>
              <div style={styles.topActions} className="top-actions-wrap">
                <button
                  style={{ ...styles.button, ...styles.buttonSmall, ...(loadingMovies ? styles.buttonLoading : {}) }}
                  className="btn-tap" onClick={fetchMovies} disabled={loadingMovies} type="button">
                  {loadingMovies ? 'Loading…' : 'Refresh'}
                </button>
                <button
                  style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }}
                  className="btn-tap"
                  onClick={() => { clearFeedback(); setShowSettings(true); setSettingsTab('services'); }}
                  type="button">⚙ Settings</button>
                {installPrompt && (
                  <button style={{ ...styles.button, ...styles.buttonSmall }} className="btn-tap" onClick={handleInstall} type="button">⬇ Install</button>
                )}
                <button style={{ ...styles.button, ...styles.buttonSecondary, ...styles.buttonSmall }} className="btn-tap" onClick={() => logout()} type="button">Logout</button>
              </div>
            </div>

            {showIosTip && (
              <div style={{ ...styles.info, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>📲 To install on iPhone: tap <strong>Share</strong> in Safari, then <strong>"Add to Home Screen"</strong>.</span>
                <button type="button" onClick={() => setShowIosTip(false)}
                  style={{ ...styles.inlineButton, fontSize: 18, lineHeight: 1, flexShrink: 0 }} aria-label="Dismiss">✕</button>
              </div>
            )}

            <div style={styles.controlRow} className="control-row-wrap">
              <div style={styles.controlGroup}>
                <span style={styles.controlLabel}>Type</span>
                <select style={styles.select} className="mk-select" value={mediaTypeFilter}
                  onChange={(e) => { setMediaTypeFilter(e.target.value); setCatalogPage(1); }}>
                  <option value="tv">TV Shows</option>
                  <option value="movie">Movies</option>
                  <option value="all">Movies + TV</option>
                  <option value="documentary">Documentary</option>
                </select>
              </div>
              <div style={styles.controlGroup}>
                <span style={styles.controlLabel}>Sort By</span>
                <select style={styles.select} className="mk-select" value={sortBy}
                  onChange={(e) => { setSortBy(e.target.value); setCatalogPage(1); }}>
                  <option value="popularity">Popularity</option>
                  <option value="recently_added">Recently Added</option>
                  <option value="release_date">Release Date (Newest)</option>
                  <option value="release_date_asc">Release Date (Oldest)</option>
                  <option value="tmdb">TMDb Rating</option>
                  <option value="imdb">IMDb Rating</option>
                  <option value="rotten_tomatoes">Rotten Tomatoes</option>
                  <option value="metacritic">Metacritic</option>
                  <option value="title">Title A–Z</option>
                </select>
              </div>
            </div>

            {/* Hide Watched toggle */}
            {watchedIds.size > 0 && (
              <div style={{ width: '100%', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button"
                  style={{ ...styles.serviceFilterButton, ...(hideWatched ? { background: 'rgba(1,210,119,0.15)', border: '1px solid rgba(1,210,119,0.35)', color: '#01d277' } : {}) }}
                  onClick={() => { setHideWatched((v) => !v); setCatalogPage(1); }}>
                  {hideWatched ? '✓ Hiding watched' : '○ Show all'}
                </button>
                <span style={{ color: '#6e7a93', fontSize: 12 }}>{watchedIds.size} watched</span>
              </div>
            )}

            {/* From Watchlist toggle */}
            {watchlistIds.size > 0 && (
              <div style={{ width: '100%', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button"
                  style={{ ...styles.serviceFilterButton, ...(watchlistOnly ? { background: 'rgba(108,99,255,0.15)', border: '1px solid rgba(108,99,255,0.5)', color: '#8b82ff' } : {}) }}
                  onClick={() => { setWatchlistOnly((v) => !v); setCatalogPage(1); }}>
                  {watchlistOnly ? '🔖 From watchlist' : '○ From watchlist'}
                </button>
                <span style={{ color: '#6e7a93', fontSize: 12 }}>{watchlistIds.size} saved</span>
              </div>
            )}

            <div style={styles.dropdownGrid} className="dropdown-grid-wrap">
              {renderFilterPanel('service', 'Service Filter',
                <span style={serviceFilters.length ? { color: '#ff8fa3' } : {}}>{serviceFilters.length || 'All'}</span>,
                <div style={styles.serviceFilterRow}>
                  {streamingPlatforms.filter((p) => selected.includes(p.key)).map((platform) => {
                    const isActive = serviceFilters.includes(platform.key);
                    return (
                      <button key={platform.key} type="button" onClick={() => toggleServiceFilter(platform.key)}
                        className="btn-tap"
                        style={{ ...styles.serviceFilterButton, ...(isActive ? styles.serviceFilterButtonActive : {}) }}>
                        <img src={platform.logo} alt={platform.name} style={styles.serviceLogoTiny} />
                        <span>{platform.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {renderFilterPanel('language', 'Language Filter',
                <span style={languageFilters.length ? { color: '#ff8fa3' } : {}}>{languageFilters.length || 'All'}</span>,
                <div style={styles.serviceFilterRow}>
                  {/* Show all languages if user has none configured, otherwise show configured languages */}
                  {(languages.length ? languageOptions.filter((l) => languages.includes(l.key)) : languageOptions).map((language) => {
                    const isActive = languageFilters.includes(language.key);
                    return (
                      <button key={language.key} type="button" onClick={() => toggleLanguageFilter(language.key)}
                        className="btn-tap"
                        style={{ ...styles.serviceFilterButton, ...(isActive ? styles.serviceFilterButtonActive : {}) }}>
                        <span>{language.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {renderFilterPanel('genre', 'Genre Filter',
                <span style={{ ...(genreFilters.length ? { color: '#c4a8ff' } : {}) }}>
                  {genreFilters.length ? `${genreFilters.length} selected` : 'All'}
                </span>,
                <>
                  <div style={styles.serviceFilterRow}>
                    {ALL_GENRES.map((genre) => {
                      const isActive = genreFilters.includes(genre.key);
                      return (
                        <button key={genre.key} type="button" onClick={() => toggleGenreFilter(genre.key)}
                          className="btn-tap"
                          style={{ ...styles.serviceFilterButton, ...(isActive ? styles.genreFilterButtonActive : {}) }}>
                          <span>{genre.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {genreFilters.length > 0 && (
                    <button type="button" onClick={() => { setGenreFilters([]); setCatalogPage(1); }}
                      style={{ background: 'none', border: 'none', color: '#e94560', fontSize: 12, cursor: 'pointer', marginTop: 8, fontFamily: 'inherit' }}>
                      Clear genres
                    </button>
                  )}
                </>
              )}

              {renderFilterPanel('year', 'Year Range',
                <span style={(yearMin !== YEAR_RANGE_MIN || yearMax !== YEAR_RANGE_MAX) ? { color: '#ff8fa3' } : {}}>
                  {(yearMin !== YEAR_RANGE_MIN || yearMax !== YEAR_RANGE_MAX) ? `${yearMin} – ${yearMax}` : 'All'}
                </span>,
                (() => {
                  const leftPct = ((yearMin - YEAR_RANGE_MIN) / (YEAR_RANGE_MAX - YEAR_RANGE_MIN)) * 100;
                  const rightPct = ((yearMax - YEAR_RANGE_MIN) / (YEAR_RANGE_MAX - YEAR_RANGE_MIN)) * 100;
                  const trackBg = `linear-gradient(to right, rgba(255,255,255,0.08) ${leftPct}%, #8b82ff ${leftPct}%, #8b82ff ${rightPct}%, rgba(255,255,255,0.08) ${rightPct}%)`;
                  return (
                    <div style={styles.yearRangeWrap}>
                      <div style={styles.yearRangeLabels}>
                        <span>{yearMin}</span>
                        <span>{yearMax}</span>
                      </div>
                      <div style={styles.yearRangeTrackWrap}>
                        <input type="range" className="year-range-input" min={YEAR_RANGE_MIN} max={YEAR_RANGE_MAX} step={1}
                          value={yearMin}
                          style={{ background: trackBg }}
                          onChange={(e) => {
                            const v = Math.min(Number(e.target.value), yearMax);
                            setYearMin(v); setCatalogPage(1);
                          }} />
                        <input type="range" className="year-range-input" min={YEAR_RANGE_MIN} max={YEAR_RANGE_MAX} step={1}
                          value={yearMax}
                          style={{ background: trackBg }}
                          onChange={(e) => {
                            const v = Math.max(Number(e.target.value), yearMin);
                            setYearMax(v); setCatalogPage(1);
                          }} />
                      </div>
                      {(yearMin !== YEAR_RANGE_MIN || yearMax !== YEAR_RANGE_MAX) && (
                        <button type="button" onClick={() => { setYearMin(YEAR_RANGE_MIN); setYearMax(YEAR_RANGE_MAX); setCatalogPage(1); }}
                          style={{ background: 'none', border: 'none', color: '#e94560', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, marginTop: 6, padding: 0 }}>
                          Clear
                        </button>
                      )}
                    </div>
                  );
                })()
              )}
            </div>

            {catalogMeta ? (
              <div style={styles.catalogMeta}>
                Showing {catalogMeta.visibleCount || movies.length} titles · page {catalogMeta.page || catalogPage} of {catalogMeta.totalPages || 1}{catalogMeta.lastUpdatedAt ? ` · Updated ${new Date(catalogMeta.lastUpdatedAt).toLocaleString()}` : ''}{catalogMeta.refreshing ? ' · ⟳ Syncing…' : ''}
              </div>
            ) : null}

            {(loadingMovies || (!movies.length && catalogMeta?.refreshing)) ? (
              <div style={styles.movieList}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} style={{ ...styles.movieCard, opacity: 0.45 }} className="movie-card-wrap">
                    <div style={{ ...styles.moviePosterPlaceholder, background: 'rgba(255,255,255,0.06)' }} className="movie-poster-ph shimmer" />
                    <div style={styles.movieBody}>
                      <div style={{ height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.08)', marginBottom: 12, width: '60%' }} className="shimmer" />
                      <div style={{ height: 16, borderRadius: 8, background: 'rgba(255,255,255,0.05)', marginBottom: 8, width: '40%' }} className="shimmer" />
                      <div style={{ height: 14, borderRadius: 8, background: 'rgba(255,255,255,0.04)', width: '90%' }} className="shimmer" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={styles.movieList}>
                {movies.map((movie) => {
                  const ratingEntries = ratingEntriesForItem(movie);
                  const isTV = movie.mediaType === 'tv';
                  const isWatched = watchedIds.has(movie.id);
                  return (
                    <div key={movie.id} style={{ ...styles.movieCard, ...styles.movieCardClickable }} className="movie-card-wrap"
                      data-media={movie.mediaType} onClick={() => fetchMovieDetails(movie)}>
                      {/* Watched toggle button */}
                      <button type="button"
                        style={{ ...styles.watchedBtn, ...(isWatched ? styles.watchedBtnActive : {}) }}
                        onClick={(e) => { e.stopPropagation(); toggleWatched(movie); }}
                        title={isWatched ? 'Remove from watched' : 'Mark as watched'}>
                        {isWatched ? '✓' : '○'}
                      </button>
                      {movie.posterUrl ? (
                        <img src={movie.posterUrl} alt={movie.title} style={styles.moviePoster}
                          className="movie-poster-el" loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = 'none'; const ph = e.currentTarget.nextSibling; if (ph) ph.style.display = 'flex'; }} />
                      ) : null}
                      <div style={{ ...styles.moviePosterPlaceholder, display: movie.posterUrl ? 'none' : 'flex' }} className="movie-poster-ph">🎬</div>
                      <div style={styles.movieBody}>
                        <div style={styles.movieTitle} className="movie-title-el">{movie.title}</div>
                        <div style={styles.movieSubhead}>
                          <span style={{ ...styles.chip, ...(isTV ? styles.chipTV : styles.chipAccent) }}>{formatMediaType(movie.mediaType)}</span>
                          {movie.year ? <span style={styles.chip}>{movie.year}</span> : null}
                        </div>
                        {movie.overview ? <div style={styles.movieOverview}>{movie.overview}</div> : null}
                        {movie.genres?.length ? (
                          <div style={styles.providerRow}>
                            {movie.genres.slice(0, 4).map((genre) => <span key={genre} style={styles.chipGenre}>{genre}</span>)}
                          </div>
                        ) : null}
                        {movie.availableOn?.length ? (
                          <div style={styles.providerRow}>
                            {movie.availableOn.map((providerName) => {
                              const platform = providerNameToPlatform[providerName];
                              return (
                                <span key={providerName} style={styles.providerChip}>
                                  {platform ? <img src={platform.logo} alt={providerName} style={styles.providerLogo} /> : null}
                                  <span>{providerName}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                        {ratingEntries.length ? (
                          <div style={styles.ratingGrid} className="rating-row">
                            {ratingEntries.map((entry) => {
                              const visual = getRatingVisual(movie, entry.key);
                              const chipAccent = getRatingChipStyle(entry.key, entry.value);
                              return (
                                <span key={entry.key} style={{ ...styles.ratingChip, ...chipAccent }}>
                                  {visual ? <img src={visual} alt={entry.label} style={styles.ratingLogo} /> : null}
                                  <span style={styles.ratingContent}>
                                    <span style={styles.ratingLabel}>{entry.label}</span>
                                    <span style={styles.ratingValue}>{entry.value}</span>
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        ) : catalogMeta?.refreshing ? (
                          <div style={{ fontSize: 11, color: 'rgba(110,122,147,0.7)', marginTop: 8 }}>⏳ Ratings loading…</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!movies.length && !loadingMovies && !catalogMeta?.refreshing ? (
              <div style={styles.emptyState}>No catalog titles match the current filters.</div>
            ) : null}

            {totalPages > 1 ? (
              <div style={styles.paginationRow}>
                <span style={styles.paginationSummary}>Page {catalogPage} of {totalPages}</span>
                <button type="button" style={styles.pageButton} className="btn-tap page-btn"
                  onClick={() => setCatalogPage((c) => Math.max(1, c - 1))} disabled={catalogPage === 1}>‹ Prev</button>
                {pageNumbers.map((pageNumber) => (
                  <button key={pageNumber} type="button" className="btn-tap page-btn"
                    style={{ ...styles.pageButton, ...(pageNumber === catalogPage ? styles.pageButtonActive : {}) }}
                    onClick={() => setCatalogPage(pageNumber)}>{pageNumber}</button>
                ))}
                <button type="button" style={styles.pageButton} className="btn-tap page-btn"
                  onClick={() => setCatalogPage((c) => Math.min(totalPages, c + 1))} disabled={catalogPage === totalPages}>Next ›</button>
              </div>
            ) : null}

            {renderFeedback()}
          </div>
        </div>

        {/* ── Movie Detail Modal ── */}
        {selectedMovie && (
          <div style={styles.modalOverlay} onClick={() => { setSelectedMovie(null); setMovieDetails(null); }}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <button type="button" style={styles.modalClose}
                onClick={() => { setSelectedMovie(null); setMovieDetails(null); }}>✕</button>
              {(movieDetails?.backdropUrl || selectedMovie.posterUrl) && (
                <img src={movieDetails?.backdropUrl || selectedMovie.posterUrl} alt=""
                  style={styles.modalBanner}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              )}
              <div style={styles.modalBody}>
                <div style={styles.modalPosterRow}>
                  {(movieDetails?.posterUrl || selectedMovie.posterUrl) && (
                    <img src={movieDetails?.posterUrl || selectedMovie.posterUrl} alt={selectedMovie.title} style={styles.modalPoster} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.modalTitle}>{selectedMovie.title}</div>
                    {movieDetails?.tagline && <div style={styles.modalTagline}>"{movieDetails.tagline}"</div>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      <span style={{ ...styles.chip, ...(selectedMovie.mediaType === 'tv' ? styles.chipTV : styles.chipAccent) }}>{formatMediaType(selectedMovie.mediaType)}</span>
                      {(movieDetails?.releaseDate || selectedMovie.releaseDate) && (
                        <span style={styles.chip}>{String(movieDetails?.releaseDate || selectedMovie.releaseDate).slice(0, 4)}</span>
                      )}
                      {movieDetails?.runtime && <span style={styles.chip}>{movieDetails.runtime} min</span>}
                      {movieDetails?.numberOfSeasons && <span style={styles.chip}>{movieDetails.numberOfSeasons} seasons</span>}
                    </div>
                    {movieDetails?.genres?.length ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {movieDetails.genres.map((g) => <span key={g} style={styles.chipGenre}>{g}</span>)}
                      </div>
                    ) : null}
                  </div>
                </div>

                {movieDetails?.directors?.length ? (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ ...styles.sectionLabel, marginBottom: 6 }}>{selectedMovie.mediaType === 'tv' ? 'Created By' : 'Director'}</div>
                    <div style={{ color: '#c0c8d8', fontSize: 14 }}>{movieDetails.directors.join(', ')}</div>
                  </div>
                ) : null}

                {(movieDetails?.overview || selectedMovie.overview) ? (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...styles.sectionLabel, marginBottom: 6 }}>Overview</div>
                    <div style={{ color: '#a0aab8', fontSize: 14, lineHeight: 1.65 }}>{movieDetails?.overview || selectedMovie.overview}</div>
                  </div>
                ) : null}

                {movieDetails?.cast?.length ? (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...styles.sectionLabel, marginBottom: 10 }}>Cast</div>
                    <div style={styles.castRow}>
                      {movieDetails.cast.map((person) => (
                        <div key={person.id} style={styles.castCard}>
                          {person.profileUrl
                            ? <img src={person.profileUrl} alt={person.name} style={styles.castImg} />
                            : <div style={{ ...styles.castImg, lineHeight: '56px', textAlign: 'center', userSelect: 'none' }}>👤</div>}
                          <div style={styles.castName}>{person.name}</div>
                          <div style={styles.castRole}>{person.character}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : loadingDetails ? (
                  <div style={{ color: '#6e7a93', fontSize: 13, marginBottom: 16 }}>Loading details…</div>
                ) : null}

                {/* Rating chips in modal */}
                {ratingEntriesForItem(selectedMovie).length ? (
                  <div style={styles.ratingGrid}>
                    {ratingEntriesForItem(selectedMovie).map((entry) => {
                      const visual = getRatingVisual(selectedMovie, entry.key);
                      const chipAccent = getRatingChipStyle(entry.key, entry.value);
                      return (
                        <span key={entry.key} style={{ ...styles.ratingChip, ...chipAccent }}>
                          {visual ? <img src={visual} alt={entry.label} style={styles.ratingLogo} /> : null}
                          <span style={styles.ratingContent}>
                            <span style={styles.ratingLabel}>{entry.label}</span>
                            <span style={styles.ratingValue}>{entry.value}</span>
                          </span>
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                {/* Watched toggle in modal */}
                <div style={{ marginTop: 20 }}>
                  <button type="button"
                    style={{ ...styles.button, ...(watchedIds.has(selectedMovie.id) ? { background: 'rgba(1,210,119,0.18)', border: '1px solid rgba(1,210,119,0.4)', color: '#01d277', boxShadow: 'none' } : {}) }}
                    onClick={() => toggleWatched(selectedMovie)}>
                    {watchedIds.has(selectedMovie.id) ? '✓ Watched — Click to Remove' : '○ Mark as Watched'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}

export default App;
