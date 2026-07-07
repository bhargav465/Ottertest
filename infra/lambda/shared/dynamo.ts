import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Meeting } from "./types";

const TABLE = process.env.MEETINGS_TABLE!;
const GSI = process.env.MEETINGS_GSI ?? "byMeetingId";

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export async function putMeeting(meeting: Meeting): Promise<void> {
  await ddb.send(new PutCommand({ TableName: TABLE, Item: meeting }));
}

export async function getMeeting(
  userId: string,
  meetingId: string
): Promise<Meeting | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { userId, meetingId } })
  );
  return res.Item as Meeting | undefined;
}

/** Find a meeting by meetingId alone (used by async pipeline callbacks). */
export async function findMeetingById(
  meetingId: string
): Promise<Meeting | undefined> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: GSI,
      KeyConditionExpression: "meetingId = :m",
      ExpressionAttributeValues: { ":m": meetingId },
      Limit: 1,
    })
  );
  return res.Items?.[0] as Meeting | undefined;
}

export async function listMeetings(userId: string): Promise<Meeting[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "userId = :u",
      ExpressionAttributeValues: { ":u": userId },
      ScanIndexForward: false, // newest first (meetingId is time-sortable)
    })
  );
  return (res.Items as Meeting[]) ?? [];
}

export async function updateMeeting(
  userId: string,
  meetingId: string,
  fields: Partial<Meeting>
): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  keys.forEach((k, i) => {
    names[`#k${i}`] = k;
    values[`:v${i}`] = (fields as Record<string, unknown>)[k];
    sets.push(`#k${i} = :v${i}`);
  });

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { userId, meetingId },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );
}

export async function deleteMeeting(
  userId: string,
  meetingId: string
): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: TABLE, Key: { userId, meetingId } })
  );
}
