'use strict';

const BUILD_STATES = new Set([
  'builder_dispatched', 'build_in_progress', 'pr_opened', 'review_pending',
  'review_approved', 'review_changes_requested', 'merge_pending',
  'deploy_in_progress', 'deployed', 'completed'
]);

const RESEARCH_STATES = new Set([
  'research_requested', 'research_in_progress', 'analysis_in_progress',
  'idea_scored', 'idea_approved', 'idea_rejected'
]);

const TRANSITIONS = {
  // Build states
  brief_received: ['contract_written', 'blocked', 'failed', 'escalated'],
  contract_written: ['builder_dispatched', 'blocked', 'failed', 'escalated'],
  builder_dispatched: ['build_in_progress', 'blocked', 'failed', 'escalated'],
  build_in_progress: ['pr_opened', 'blocked', 'failed', 'escalated'],
  pr_opened: ['review_pending', 'blocked', 'failed', 'escalated'],
  review_pending: ['review_approved', 'review_changes_requested', 'blocked', 'failed', 'escalated'],
  review_approved: ['merge_pending', 'blocked', 'failed', 'escalated'],
  review_changes_requested: ['builder_dispatched', 'blocked', 'failed', 'escalated'],
  merge_pending: ['deployed', 'deploy_in_progress', 'blocked', 'failed', 'escalated'],
  deploy_in_progress: ['deployed', 'failed', 'blocked', 'escalated'],
  deployed: ['completed', 'blocked', 'failed', 'escalated'],
  completed: ['blocked', 'failed', 'escalated'],
  blocked: ['blocked', 'failed', 'escalated'],
  failed: ['blocked', 'failed', 'escalated'],
  escalated: ['blocked', 'failed', 'escalated'],
  // Research states
  research_requested: ['research_in_progress', 'blocked', 'failed', 'escalated'],
  research_in_progress: ['analysis_in_progress', 'blocked', 'failed', 'escalated'],
  analysis_in_progress: ['idea_scored', 'blocked', 'failed', 'escalated'],
  idea_scored: ['idea_approved', 'idea_rejected', 'blocked', 'failed', 'escalated'],
  idea_approved: ['blocked', 'failed', 'escalated'],
  idea_rejected: ['blocked', 'failed', 'escalated']
};

function isValidTransition(fromState, toState) {
  const allowed = TRANSITIONS[fromState];
  return allowed ? allowed.includes(toState) : false;
}

function checkTypeRouting(taskType, toState) {
  const type = taskType || 'build';
  if (type === 'research' && BUILD_STATES.has(toState)) {
    return { error: 'Research tasks cannot enter build states' };
  }
  if (type === 'build' && RESEARCH_STATES.has(toState)) {
    return { error: 'Build tasks cannot enter research states' };
  }
  return null;
}

module.exports = { isValidTransition, checkTypeRouting, BUILD_STATES, RESEARCH_STATES };
