import { FastifyRequest, FastifyReply } from 'fastify';
import * as service from './knowledge.service.js';
import {
  uploadSchema,
  listSourcesSchema,
  searchSchema,
  crawlUrlSchema,
  connectNotionSchema,
} from './knowledge.schema.js';

export async function uploadDocument(request: FastifyRequest, reply: FastifyReply) {
  const file = await request.file();

  if (!file) {
    return reply.status(400).send({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' },
    });
  }

  // Extract name from multipart fields (if provided)
  let nameValue: string | undefined;
  const nameField = file.fields?.name;
  if (nameField) {
    if (Array.isArray(nameField)) {
      const first = nameField[0];
      if (first && first.type === 'field') {
        nameValue = String(first.value);
      }
    } else if (nameField.type === 'field') {
      nameValue = String(nameField.value);
    }
  }
  const body = uploadSchema.parse({ name: nameValue });
  const buffer = await file.toBuffer();

  const result = await service.uploadDocument({
    tenantId: request.tenant!.id,
    filename: file.filename,
    mimeType: file.mimetype,
    buffer,
    name: body.name,
  });

  return reply.status(201).send({ success: true, data: result });
}

export async function listSources(request: FastifyRequest, reply: FastifyReply) {
  const query = listSourcesSchema.parse(request.query);
  const result = await service.listSources(request.tenant!.id, query);
  return reply.send({ success: true, data: result });
}

export async function getSource(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const source = await service.getSource(request.tenant!.id, request.params.id);

  if (!source) {
    return reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Source not found' },
    });
  }

  return reply.send({ success: true, data: source });
}

export async function deleteSource(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  await service.deleteSource(request.tenant!.id, request.params.id);
  return reply.send({ success: true, data: { deleted: true } });
}

export async function reindexSource(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const result = await service.reindexSource(request.tenant!.id, request.params.id);
  return reply.send({ success: true, data: result });
}

export async function searchKnowledge(request: FastifyRequest, reply: FastifyReply) {
  const query = searchSchema.parse(request.query);
  const results = await service.searchKnowledge(request.tenant!.id, query);
  return reply.send({ success: true, data: results });
}

export async function crawlUrl(request: FastifyRequest, reply: FastifyReply) {
  const body = crawlUrlSchema.parse(request.body);

  try {
    const result = await service.createUrlSource(request.tenant!.id, body);
    return reply.status(201).send({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Invalid URL') || message.includes('Unsupported URL scheme')) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message },
      });
    }
    throw error;
  }
}

export async function getCrawlStatus(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const result = await service.getCrawlStatus(request.tenant!.id, request.params.id);
    return reply.send({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Source not found' || message === 'Source is not a URL type') {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message },
      });
    }
    throw error;
  }
}

export async function cancelCrawl(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const result = await service.cancelCrawl(request.tenant!.id, request.params.id);
    return reply.send({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Source not found' || message === 'Source is not a URL type') {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message },
      });
    }
    if (
      message.includes('already') ||
      message === 'Crawl state not found - crawl may not have started'
    ) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message },
      });
    }
    throw error;
  }
}

export async function connectNotion(request: FastifyRequest, reply: FastifyReply) {
  const body = connectNotionSchema.parse(request.body);
  const result = await service.connectNotion(request.tenant!.id, body);
  return reply.status(201).send({ success: true, data: result });
}

export async function syncSource(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const result = await service.syncSource(request.tenant!.id, request.params.id);
  return reply.send({ success: true, data: result });
}
