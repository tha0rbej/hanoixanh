'use strict';
// Nạp workflow n8n từ file JSON và tìm node theo tên. Chỉ dùng thư viện chuẩn của Node.
const fs = require('node:fs');
const path = require('node:path');

const ADMIN_AGENT_DIR = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(ADMIN_AGENT_DIR, '..', '..');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');

// File JSON không phải workflow.
const NON_WORKFLOW_FILES = new Set(['tool-contracts.json']);

function listWorkflowFiles() {
  return fs
    .readdirSync(ADMIN_AGENT_DIR)
    .filter((f) => f.endsWith('.json') && !NON_WORKFLOW_FILES.has(f))
    .sort();
}

function loadWorkflow(file) {
  const full = path.isAbsolute(file) ? file : path.join(ADMIN_AGENT_DIR, file);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ADMIN_AGENT_DIR, file), 'utf8'));
}

function findNode(workflow, name) {
  return workflow.nodes.find((n) => n.name === name);
}

function mustFindNode(workflow, name) {
  const node = findNode(workflow, name);
  if (!node) throw new Error(`Không có node "${name}" trong workflow "${workflow.name}"`);
  return node;
}

function getCode(workflow, name) {
  const node = mustFindNode(workflow, name);
  if (typeof node.parameters.jsCode !== 'string') throw new Error(`Node "${name}" không phải node Code`);
  return node.parameters.jsCode;
}

function getToolCode(workflow, name) {
  const node = mustFindNode(workflow, name);
  if (typeof node.parameters.jsCode !== 'string') throw new Error(`Node "${name}" không có jsCode`);
  return node.parameters.jsCode;
}

function triggerNode(workflow) {
  return workflow.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
}

function triggerInputs(workflow) {
  const t = triggerNode(workflow);
  return t ? t.parameters.workflowInputs.values.map((v) => v.name) : [];
}

module.exports = {
  ADMIN_AGENT_DIR,
  REPO_ROOT,
  SKILLS_DIR,
  listWorkflowFiles,
  loadWorkflow,
  loadJson,
  findNode,
  mustFindNode,
  getCode,
  getToolCode,
  triggerNode,
  triggerInputs,
};
