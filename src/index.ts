/**
 * RTD Board to Slack Mirror Worker
 *
 * This worker runs on a cron schedule (every minute) to mirror conversations
 * from the RTD Board Collaboration Tool to a Slack channel. Each topic becomes
 * a thread, with replies posted to that thread.
 *
 * Required secrets (set with `wrangler secret put`):
 * - SLACK_BOT_TOKEN: Slack bot token (xoxb-...)
 * - SLACK_CHANNEL_ID: Slack channel ID to post to
 */

import htmlToMrkdwn from 'html-to-mrkdwn-ts';

// RTD Board API types
interface RTDReply {
	id: string;
	summary: string | null;
	content: string;
	displayName: string;
	replyToId: string;
	lastUpdated: string;
	createdDateTime: string;
	deletedDateTime: string | null;
	attachments: unknown[];
}

interface RTDMessage {
	messageId: string;
	subject: string;
	from: string;
	content: string;
	lastUpdated: string;
	createdDateTime: string;
	deletedDateTime: string | null;
	replies: RTDReply[];
}

interface RTDApiResponse {
	success: boolean;
	data: {
		messages: RTDMessage[];
		messageCount: number;
		totalReplies: number;
	};
}

// KV storage types
interface TopicMirrorState {
	slackThreadTs: string;
	lastMirroredAt: string;
}

// Extend Env to include secrets
interface AppEnv extends Env {
	SLACK_BOT_TOKEN: string;
	SLACK_CHANNEL_ID: string;
}

const RTD_API_URL =
	'https://board-teams-node-server.wonderfulmoss-5a425eaf.northcentralus.azurecontainerapps.io/api/teams/messagesWithReplies';

// Avatar mapping for board members and staff
const AVATAR_MAP: Record<string, string> = {
	'Chris Nicholson': 'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738600760/IMG_0760_iyqum9.jpg',
	'JoyAnn Ruscha': 'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1698851625/Ruscha_zaato7.jpg',
	'Michael Guzman': 'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738362707/thumbnail_Guzman_nz04pq.jpg',
	'Chris Gutschenritter':
		'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738362697/thumbnail_Gutschenritter_l9dhi3.jpg',
	'Matt Larsen': 'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738362717/thumbnail_Larsen_eco5rh.jpg',
	'Kathleen Chandler':
		'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738362675/thumbnail_Chandler_u4sqzo.jpg',
	'Julien Bouquet': 'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738362757/thumbnail_Bouquet_fntnqq.jpg',
	"Patrick O'Keefe":
		'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738362739/thumbnail_O_Keefe_ntt9hd.jpg',
	'Karen Benker': 'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738362666/thumbnail_Benker_ynmwkz.jpg',
	'Vince Buzek': 'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1695931265/63cbc42b-f052-49fe-b70a-162a84ebd8dc.jpg',
	'Troy Whitmore':
		'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1695931271/5534c3fe-da3b-46bd-a8f4-ba2436bdb23c.jpg',
	'Troy L. Whitmore':
		'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1695931271/5534c3fe-da3b-46bd-a8f4-ba2436bdb23c.jpg',
	'Ian Harwick': 'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738598919/thumbnail_Harwick_ut6xcb.jpg',
	'Brett Paglieri':
		'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1738362746/thumbnail_Paglieri_cgpwng.jpg',
	'Lynn Guissinger':
		'https://cdn.rtd-denver.com/image/upload/t_default_headshot/f_auto,q_auto/v1695931291/b9771204-056b-476f-9966-7089766b771b.jpg',
	'Jack Kroll': 'https://business-news.ucdenver.edu/wp-content/uploads/2020/09/reg_kroll_1.jpg',
};

/**
 * Find avatar URL for a given name (supports partial matching)
 */
function getAvatarUrl(name: string): string | undefined {
	// Try exact match first
	if (AVATAR_MAP[name]) {
		return AVATAR_MAP[name];
	}

	// Try partial match (name might include titles or be formatted differently)
	const lowerName = name.toLowerCase();
	for (const [key, url] of Object.entries(AVATAR_MAP)) {
		if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
			return url;
		}
	}

	return undefined;
}

/**
 * Post a message to Slack with optional custom avatar
 */
async function postToSlack(
	token: string,
	channel: string,
	text: string,
	options?: { threadTs?: string; username?: string; iconUrl?: string }
): Promise<{ ok: boolean; ts?: string; error?: string }> {
	const response = await fetch('https://slack.com/api/chat.postMessage', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			channel,
			text,
			...(options?.threadTs && { thread_ts: options.threadTs }),
			...(options?.username && { username: options.username }),
			...(options?.iconUrl && { icon_url: options.iconUrl }),
		}),
	});

	return response.json();
}

/**
 * Fetch messages from the RTD Board API
 */
async function fetchRTDMessages(): Promise<RTDMessage[]> {
	const response = await fetch(RTD_API_URL);
	if (!response.ok) {
		throw new Error(`RTD API error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as RTDApiResponse;
	if (!data.success) {
		throw new Error('RTD API returned success: false');
	}

	return data.data.messages;
}

/**
 * Get the KV key for a topic
 */
function getTopicKey(messageId: string): string {
	return `topic:${messageId}`;
}

/**
 * Get the KV key for a reply
 */
function getReplyKey(replyId: string): string {
	return `reply:${replyId}`;
}

/**
 * Mirror a single topic to Slack
 */
async function mirrorTopic(
	topic: RTDMessage,
	env: AppEnv
): Promise<{ isNew: boolean; threadTs: string | null; error?: string }> {
	const topicKey = getTopicKey(topic.messageId);

	// Check if topic already exists in KV
	const existingState = await env.MIRROR_STATE.get<TopicMirrorState>(topicKey, 'json');

	if (existingState) {
		return { isNew: false, threadTs: existingState.slackThreadTs };
	}

	// Format the topic message
	const topicContent = htmlToMrkdwn(topic.content).text;
	const slackMessage = `*${topic.subject}*\n\n${topicContent}`;

	// Post to Slack with custom avatar
	const avatarUrl = getAvatarUrl(topic.from);
	const result = await postToSlack(env.SLACK_BOT_TOKEN, env.SLACK_CHANNEL_ID, slackMessage, {
		username: topic.from,
		iconUrl: avatarUrl,
	});

	if (!result.ok) {
		const error = `Failed to post topic "${topic.subject}": ${result.error}`;
		console.error(error);
		return { isNew: false, threadTs: null, error };
	}

	// Save the thread_ts to KV
	const state: TopicMirrorState = {
		slackThreadTs: result.ts!,
		lastMirroredAt: new Date().toISOString(),
	};
	await env.MIRROR_STATE.put(topicKey, JSON.stringify(state));

	console.log(`Mirrored new topic: ${topic.subject} (thread_ts: ${result.ts})`);
	return { isNew: true, threadTs: result.ts! };
}

/**
 * Mirror a single reply to a Slack thread
 */
async function mirrorReply(reply: RTDReply, threadTs: string, env: AppEnv): Promise<{ isNew: boolean; error?: string }> {
	const replyKey = getReplyKey(reply.id);

	// Check if reply already exists in KV
	const existingReply = await env.MIRROR_STATE.get(replyKey);
	if (existingReply) {
		return { isNew: false };
	}

	// Format the reply message
	const replyContent = htmlToMrkdwn(reply.content).text;

	// Post to Slack thread with custom avatar
	const avatarUrl = getAvatarUrl(reply.displayName);
	const result = await postToSlack(env.SLACK_BOT_TOKEN, env.SLACK_CHANNEL_ID, replyContent, {
		threadTs,
		username: reply.displayName,
		iconUrl: avatarUrl,
	});

	if (!result.ok) {
		const error = `Failed to post reply from ${reply.displayName}: ${result.error}`;
		console.error(error);
		return { isNew: false, error };
	}

	// Mark reply as mirrored in KV
	await env.MIRROR_STATE.put(replyKey, new Date().toISOString());

	console.log(`Mirrored new reply from ${reply.displayName} (ts: ${result.ts})`);
	return { isNew: true };
}

/**
 * Main sync function
 */
interface SyncResult {
	topics: number;
	replies: number;
	errors: string[];
}

async function syncMessages(env: AppEnv): Promise<SyncResult> {
	const messages = await fetchRTDMessages();
	console.log(`Fetched ${messages.length} topics from RTD API`);
	let newTopics = 0;
	let newReplies = 0;
	const errors: string[] = [];

	for (const topic of messages) {
		// Skip deleted topics
		if (topic.deletedDateTime) {
			continue;
		}

		// Mirror the topic
		const topicResult = await mirrorTopic(topic, env);
		if (topicResult.isNew) {
			newTopics++;
		}
		if (topicResult.error) {
			errors.push(topicResult.error);
		}

		// If we have a thread, mirror replies
		if (topicResult.threadTs && topic.replies.length > 0) {
			// Sort replies by creation date to maintain order
			const sortedReplies = [...topic.replies].sort(
				(a, b) => new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime()
			);

			for (const reply of sortedReplies) {
				// Skip deleted replies
				if (reply.deletedDateTime) {
					continue;
				}

				const replyResult = await mirrorReply(reply, topicResult.threadTs, env);
				if (replyResult.isNew) {
					newReplies++;
				}
				if (replyResult.error) {
					errors.push(replyResult.error);
				}
			}
		}
	}

	return { topics: newTopics, replies: newReplies, errors };
}

export default {
	async fetch(req: Request, env: AppEnv): Promise<Response> {
		const url = new URL(req.url);

		// Allow manual trigger for testing
		if (url.pathname === '/sync') {
			try {
				const result = await syncMessages(env);
				const success = result.errors.length === 0;
				return new Response(JSON.stringify({ success, ...result }), {
					status: success ? 200 : 500,
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				return new Response(JSON.stringify({ success: false, error: message }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '* * * * *');
		return new Response(
			`RTD Board Mirror Worker\n\nTo test:\n- Scheduled: curl "${url.href}"\n- Manual sync: curl "${new URL('/sync', req.url).href}"`
		);
	},

	async scheduled(controller: ScheduledController, env: AppEnv, _ctx: ExecutionContext): Promise<void> {
		console.log(`Cron triggered at ${controller.cron}`);

		try {
			const result = await syncMessages(env);
			console.log(`Sync complete: ${result.topics} new topics, ${result.replies} new replies`);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error';
			console.error(`Sync failed: ${message}`);
		}
	},
} satisfies ExportedHandler<AppEnv>;
