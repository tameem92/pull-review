'use strict';

var Promise = require('native-promise-only');
var debug = require('debug');

var Github = require('./github');
var generatePlan = require('./generate-plan');
var Action = require('./models/action');
var GithubMessage = require('./models/messages/github');
var HubotMessage = require('./models/messages/hubot');

var log = debug('pull-review');

var defaultNotifyFn = function defaultNotifyFn(message) {
  console.info(message);
};

var generateNotification = function generateNotification(input) {
  input = input || {};
  var channel = input.channel.split(':');
  var source = channel[0];

  if (source === 'hubot') {
    return HubotMessage(input);
  }
};

module.exports = function PullReview(options) {
  options = options || {};
  var actions;
  var loggedEvents = [];
  var dryRun = Boolean(options.dryRun);
  var notifyFn = options.notifyFn || defaultNotifyFn;
  var github = Github(options.githubToken);
  options.github = github;

  log('started on ' + options.pullRequestURL);

  return generatePlan(options)
    .then(function(res) {
      actions = res;

      var transaction = [];

      actions = actions.map(Action);
      actions.forEach(function(action) {
        switch (action.type) {
          case 'ASSIGN_USERS_TO_PULL_REQUEST':
            transaction.push(function() {
              return github.assignUsersToPullRequest(
                action.payload.pullRequest,
                action.payload.assignees
              );
            });
            loggedEvents.push(
              'assigned ' + action.payload.assignees.join(', ')
            );
            break;
          case 'UNASSIGN_USERS_FROM_PULL_REQUEST':
            transaction.push(function() {
              return github.unassignUsersFromPullRequest(
                action.payload.pullRequest,
                action.payload.assignees
              );
            });
            loggedEvents.push(
              'unassigned ' + action.payload.assignees.join(', ')
            );
            break;
          case 'NOTIFY':
            if (action.payload.channel === 'github') {
              transaction.push(function() {
                return github.postPullRequestComment(
                  action.payload.pullRequest,
                  GithubMessage(action.payload)
                );
              });
              loggedEvents.push('posted GitHub comment');
            } else {
              transaction.push(function() {
                return new Promise(function(resolve, reject) {
                  try {
                    var notification = generateNotification(action.payload);
                    resolve(notifyFn(notification));
                  } catch (e) {
                    console.error(e);
                    reject(Error('Failed to notify'));
                  }
                });
              });
            }
            break;
          default:
            throw Error('Unhandled action: ' + action.type);
        }
      });

      return Promise.resolve().then(function() {
        return transaction.reduce(function(promise, fn) {
          return promise.then(dryRun ? null : fn());
        }, Promise.resolve());
      });
    })
    .then(function() {
      if (loggedEvents.length) {
        log(
          (dryRun ? 'would have ' : '') +
            loggedEvents.join(', ') +
            ' on ' +
            options.pullRequestURL
        );
      }

      return actions;
    });
};
