/**
 * Room Recovery Script
 * Restores a room's content from a master text file by:
 * 1. Creating a fresh Y.Doc
 * 2. Converting markdown to ProseMirror XML structure
 * 3. Encoding as base64
 * 4. Pushing directly to Supabase via RPC
 *
 * Usage: node scripts/restore-room.mjs <room-id> <master-text-file> [--env dev|prod]
 */

import { createClient } from '@supabase/supabase-js';
import * as Y from 'yjs';
import { readFileSync } from 'fs';

// --- Config ---
const ENV_CONFIG = {
  prod: {
    url: 'https://juberlfvyedrbiixrkxt.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1YmVybGZ2eWVkcmJpaXhya3h0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNTcyMTcsImV4cCI6MjA4NTYzMzIxN30.Xom-I23EyDMIq_skpdF4lmLNDEg8NZQ9498QfVI6siA',
  },
  dev: {
    url: 'https://lkmzqgwookmujuhuqpdy.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrbXpxZ3dvb2ttdWp1aHVxcGR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0ODA1NTQsImV4cCI6MjA4NjA1NjU1NH0._d842Z06R8NtbYz3Gp2dihdAlLCWjpYyAikrlhiDHbs',
  },
};

// --- Parse args ---
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/restore-room.mjs <room-id> <master-text-file> [--env dev|prod]');
  console.error('Example: node scripts/restore-room.mjs happy-chaos /Users/andyt/Downloads/master_tex.txt --env prod');
  process.exit(1);
}

const roomId = args[0];
const masterFile = args[1];
const envFlag = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'prod';
const config = ENV_CONFIG[envFlag];

if (!config) {
  console.error(`Unknown env: ${envFlag}. Use 'dev' or 'prod'.`);
  process.exit(1);
}

// --- Read master text ---
console.log(`📄 Reading master text from: ${masterFile}`);
const masterText = readFileSync(masterFile, 'utf-8');
const lines = masterText.split('\n');
console.log(`   ${lines.length} lines`);

// --- Build Y.Doc with ProseMirror structure ---
console.log('🔧 Building Y.Doc...');
const doc = new Y.Doc();
const fragment = doc.getXmlFragment('prosemirror');

// Simple markdown → ProseMirror converter (mirrors markdownToProsemirror.ts)
let i = 0;
while (i < lines.length) {
  const line = lines[i].trimEnd();

  if (!line) {
    fragment.push([new Y.XmlElement('paragraph')]);
    i++;
    continue;
  }

  const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const text = headingMatch[2];
    const heading = new Y.XmlElement('heading');
    heading.setAttribute('level', level);
    fragment.push([heading]);
    heading.push([new Y.XmlText(text)]);
    i++;
    continue;
  }

  // Unordered list item
  const bulletMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
  if (bulletMatch) {
    const listItems = [];
    while (i < lines.length) {
      const l = lines[i].trimEnd();
      const m = l.match(/^(\s*)[-*+]\s+(.+)$/);
      if (!m) break;
      listItems.push({ indent: m[1].length, text: m[2] });
      i++;
    }
    // Build flat bullet list (nested lists are complex, keep it simple for recovery)
    const bulletList = new Y.XmlElement('bulletList');
    fragment.push([bulletList]);
    for (const item of listItems) {
      const li = new Y.XmlElement('listItem');
      bulletList.push([li]);
      const p = new Y.XmlElement('paragraph');
      li.push([p]);
      p.push([new Y.XmlText(item.text)]);
    }
    continue;
  }

  // Code block
  if (line.startsWith('```')) {
    const codeLines = [];
    i++;
    while (i < lines.length && !lines[i].startsWith('```')) {
      codeLines.push(lines[i]);
      i++;
    }
    i++; // skip closing ```
    const codeBlock = new Y.XmlElement('codeBlock');
    fragment.push([codeBlock]);
    codeBlock.push([new Y.XmlText(codeLines.join('\n'))]);
    continue;
  }

  // Default: paragraph
  const p = new Y.XmlElement('paragraph');
  fragment.push([p]);
  p.push([new Y.XmlText(line)]);
  i++;
}

// Also set text content for search
const textContent = masterText;
doc.getText('content').insert(0, textContent);

// Count cards
const cardCount = (masterText.match(/^## /gm) || []).length;
const sectionCount = (masterText.match(/^# /gm) || []).length;
console.log(`   ${sectionCount} sections, ${cardCount} cards, ${fragment.length} XML nodes`);

// --- Encode as base64 ---
const stateUpdate = Y.encodeStateAsUpdate(doc);
let binary = '';
const chunkSize = 8192;
for (let j = 0; j < stateUpdate.length; j += chunkSize) {
  const chunk = stateUpdate.subarray(j, j + chunkSize);
  binary += String.fromCharCode.apply(null, Array.from(chunk));
}
const base64State = btoa(binary);
console.log(`   Encoded: ${base64State.length} base64 chars (${stateUpdate.length} bytes)`);

// --- Push to Supabase ---
console.log(`\n🚀 Pushing to Supabase (${envFlag})...`);
console.log(`   Room: ${roomId}`);
console.log(`   Document ID: room-${roomId}`);

const supabase = createClient(config.url, config.key);

const { data, error } = await supabase.rpc('upsert_document_rpc', {
  p_id: `room-${roomId}`,
  p_title: 'Main Document',
  p_owner_id: null,
  p_yjs_state_base64: base64State,
  p_content_text: textContent,
  p_last_edited_by: 'restore-script',
  p_min_version: 0,
  p_snapshot_every_n: 1, // Force a snapshot for this restore
  p_snapshot_every_seconds: 0,
});

if (error) {
  console.error('❌ Failed to push:', error);
  process.exit(1);
}

console.log('✅ Room restored successfully!');
console.log(`   Response: ${JSON.stringify(data)}`);
console.log(`\n📋 Summary:`);
console.log(`   Room: ${roomId}`);
console.log(`   Cards: ${cardCount}`);
console.log(`   Sections: ${sectionCount}`);
console.log(`\n   Users can now refresh their browsers to see the restored content.`);

doc.destroy();
