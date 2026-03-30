'use strict';

const TERMINAL_STATES = new Set(['completed', 'archived', 'cancelled', 'abandoned']);

const TRANSITIONS = {
  brief_received: ['contract_written', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  contract_written: ['builder_dispatched', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  builder_dispatched: ['build_in_progress', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  build_in_progress: ['pr_opened', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  pr_opened: ['review_pending', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  review_pending: ['review_approved', 'review_changes_requested', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  review_approved: ['merge_in_progress', 'merge_pending', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  review_changes_requested: ['review_pending', 'review_approved', 'builder_dispatched', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  merge_in_progress: ['merge_pending', 'deploy_in_progress', 'deployed', 'completed', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  merge_pending: ['deployed', 'deploy_in_progress', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  deploy_in_progress: ['deployed', 'completed', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  deployed: ['completed', 'blocked', 'failed', 'escalated', 'qa_passed', 'qa_failed', 'archived', 'cancelled', 'abandoned'],
  qa_passed: ['completed', 'archived', 'cancelled', 'abandoned'],
  qa_failed: ['archived', 'cancelled', 'abandoned'],
  repo_bootstrap_pending: ['contract_written', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  completed: [],
  archived: [],
  cancelled: [],
  abandoned: [],
  blocked: ['review_approved', 'review_pending', 'builder_dispatched', 'blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  failed: ['blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned'],
  escalated: ['blocked', 'failed', 'escalated', 'archived', 'cancelled', 'abandoned']
};

function isValidTransition(fromState, toState) {
  const allowed = TRANSITIONS[fromState];
  return Array.isArray(allowed) ? allowed.includes(toState) : false;
}

function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

module.exports = { isValidTransition, isTerminalState };
