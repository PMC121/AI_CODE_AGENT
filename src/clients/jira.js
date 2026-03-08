// src/clients/jira.js
// Jira REST API v3 client

import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const isBearerToken = config.jira.email.includes('example.com') || config.jira.email.toLowerCase() === 'pat';

const jiraHttp = axios.create({
  baseURL: `${config.jira.baseUrl}/rest/api/2`,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...(isBearerToken ? { 'Authorization': `Bearer ${config.jira.apiToken}` } : {})
  },
  ...(!isBearerToken ? {
    auth: {
      username: config.jira.email,
      password: config.jira.apiToken,
    }
  } : {})
});

/**
 * Fetch a Jira issue by key (e.g. "PROJ-123").
 * Returns a normalised ticket object.
 */
export async function fetchJiraTicket(ticketId) {
  logger.info('Fetching Jira ticket…', ticketId);

  const response = await jiraHttp.get(`/issue/${ticketId}`, {
    params: {
      fields: 'summary,description,issuetype,status,priority,labels,assignee,comment,acceptance',
    },
  });

  const { fields } = response.data;

  if (!fields) {
    logger.warn('Jira API response does not contain a "fields" object.', JSON.stringify(response.data).slice(0, 300));
  }

  // Convert Atlassian Document Format (ADF) description to plain text
  const description = extractPlainText(fields?.description);

  const ticket = {
    id: ticketId,
    summary: fields?.summary || '',
    description,
    type: fields?.issuetype?.name || 'Task',
    status: fields?.status?.name || '',
    priority: fields?.priority?.name || 'Medium',
    labels: fields?.labels || [],
    assignee: fields?.assignee?.displayName || 'Unassigned',
    url: `${config.jira.baseUrl}/browse/${ticketId}`,
  };

  logger.success('Jira ticket fetched', `"${ticket.summary}"`);
  return ticket;
}

/**
 * Recursively extract plain text from Atlassian Document Format (ADF).
 */
function extractPlainText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractPlainText).join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}
