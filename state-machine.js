'use strict';

const TRANSITIONS = {
  brief_received: ['contract_written', 'blocked', 'failed', 'escalated'],
  contract_written: ['builder_dispatched', 'blocked', 'failed', 'escalated'],
  builder_dispatched: ['build_in_progress', 'blocked', 'failed', 'escalated'],
  build_in_progress: ['pr_opened', 'blocked', 'failed', 'escalated'],
  pr_opened: ['review_pending', 'blocked', 'failed', 'escalated'],
  review_pending: ['review_approved', 'review_changes_requested', 'blocked', 'failed', 'escalated'],
  review_approved: ['merge_in_progress', 'merge_pending', 'blocked', 'failed', 'escalated'],
  review_changes_requested: ['builder_dispatched', 'blocked', 'failed', 'escalated'],
  merge_in_progress: ['merge_pending', 'deploy_in_progress', 'deployed', 'completed', 'blocked', 'failed', 'escalated'],
  merge_pending: ['deployed', 'deploy_in_progress', 'blocked', 'failed', 'escalated'],
  deploy_in_progress: ['deployed', 'completed', 'blocked', 'failed', 'escalated'],
  deployed: ['completed', 'blocked', 'failed', 'escalated'],
  completed: ['blocked', 'failed', 'escalated'],
  blocked: ['review_approved', 'review_pending', 'builder_dispatched', 'blocked', 'failed', 'escalated'],
  failed: ['blocked', 'failed', 'escalated'],
  escalated: ['blocked', 'failed', 'escalated']
};

function isValidTransition(fromState, toState) {
  const allowed = TRANSITIONS[fromState];
  return allowed ? allowed.includes(toState) : false;
}

module.exports = { isValidTransition };
