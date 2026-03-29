'use strict';

const TRANSITIONS = {
  brief_received: ['contract_written', 'blocked', 'escalated'],
  contract_written: ['builder_dispatched', 'blocked', 'escalated'],
  builder_dispatched: ['build_in_progress', 'blocked', 'escalated'],
  build_in_progress: ['pr_opened', 'blocked', 'escalated'],
  pr_opened: ['review_pending', 'blocked', 'escalated'],
  review_pending: ['review_approved', 'review_changes_requested', 'blocked', 'escalated'],
  review_approved: ['merge_pending', 'blocked', 'escalated'],
  review_changes_requested: ['builder_dispatched', 'blocked', 'escalated'],
  merge_pending: ['deployed', 'blocked', 'escalated'],
  deployed: ['completed', 'blocked', 'escalated'],
  completed: ['blocked', 'escalated'],
  blocked: ['blocked', 'escalated'],
  escalated: ['blocked', 'escalated']
};

function isValidTransition(fromState, toState) {
  const allowed = TRANSITIONS[fromState];
  return allowed ? allowed.includes(toState) : false;
}

module.exports = { isValidTransition };
