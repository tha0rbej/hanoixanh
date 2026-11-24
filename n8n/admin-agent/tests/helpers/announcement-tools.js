'use strict';
// Mô tả 7 tool thông báo: file workflow, id, tên node kiểm tra đầu vào, tên RPC và input của trigger.
const UUID = {
  thread: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  admin: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  campaign: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  announcement: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

const TRIGGER = 'When Executed by Another Workflow';

const TOOLS = [
  {
    tool: 'find_announcement_events',
    file: 'find-announcement-events.json',
    id: 'hnxToolFindAnnouncementEvents',
    validate: 'Validate Input',
    rpc: 'find_announcement_campaigns',
    inputs: ['query', 'limit'],
    modelFields: ['query', 'limit'],
  },
  {
    tool: 'get_event_registrants',
    file: 'get-event-registrants.json',
    id: 'hnxToolGetEventRegistrants',
    validate: 'Validate Input',
    rpc: 'announcement_campaign_registrants',
    inputs: ['campaign_id'],
    modelFields: ['campaign_id'],
  },
  {
    tool: 'save_announcement_draft',
    file: 'save-announcement-draft.json',
    id: 'hnxToolSaveAnnouncementDraft',
    validate: 'Sanitize Draft',
    rpc: 'upsert_announcement_draft',
    inputs: ['thread_id', 'admin_user_id', 'campaign_id', 'subject', 'body'],
    modelFields: ['campaign_id', 'subject', 'body'],
  },
  {
    tool: 'get_announcement_status',
    file: 'get-announcement-status.json',
    id: 'hnxToolGetAnnouncementStatus',
    validate: 'Validate Input',
    rpc: 'get_announcement',
    inputs: ['thread_id', 'announcement_id'],
    modelFields: ['announcement_id'],
  },
  {
    tool: 'send_test_announcement',
    file: 'send-test-announcement.json',
    id: 'hnxToolSendTestAnnouncement',
    validate: 'Validate Input',
    rpc: 'request_announcement_test',
    inputs: ['thread_id', 'admin_user_id', 'announcement_id', 'version'],
    modelFields: ['announcement_id', 'version'],
  },
  {
    tool: 'approve_and_send_announcement',
    file: 'approve-and-send-announcement.json',
    id: 'hnxToolApproveAndSendAnnouncement',
    validate: 'Validate Send',
    rpc: 'approve_announcement',
    inputs: ['thread_id', 'admin_user_id', 'announcement_id', 'version', 'confirmation_text', 'turn_started_at'],
    modelFields: ['announcement_id', 'version'],
  },
  {
    tool: 'cancel_announcement',
    file: 'cancel-announcement.json',
    id: 'hnxToolCancelAnnouncement',
    validate: 'Validate Cancel',
    rpc: 'cancel_announcement',
    inputs: ['thread_id', 'admin_user_id', 'announcement_id', 'confirmation_text'],
    modelFields: ['announcement_id'],
  },
];

const BY_TOOL = Object.fromEntries(TOOLS.map((t) => [t.tool, t]));

// Các trường nhạy cảm luôn do workflow chính gắn cố định, model không được điền.
const FIXED_FIELDS = ['thread_id', 'admin_user_id', 'confirmation_text', 'turn_started_at', 'trigger_source'];

module.exports = { UUID, TRIGGER, TOOLS, BY_TOOL, FIXED_FIELDS };
