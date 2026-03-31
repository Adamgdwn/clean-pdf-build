import type { FastifyPluginAsync, FastifyReply } from "fastify";

import {
  AppError,
  addFieldForAuthorizationHeader,
  addSignerForAuthorizationHeader,
  clearDocumentFieldsForAuthorizationHeader,
  createDocumentForAuthorizationHeader,
  createDocumentShareLinkForAuthorizationHeader,
  deleteDocumentForAuthorizationHeader,
  duplicateDocumentForAuthorizationHeader,
  getDocumentDownloadUrlForAuthorizationHeader,
  getDocumentForAuthorizationHeader,
  inviteCollaboratorForAuthorizationHeader,
  listDocumentsForAuthorizationHeader,
  lockDocumentForAuthorizationHeader,
  requestProcessingJobForAuthorizationHeader,
  reopenDocumentForAuthorizationHeader,
  redoDocumentEditorForAuthorizationHeader,
  completeFieldForAuthorizationHeader,
  sendDocumentForAuthorizationHeader,
  updateDocumentRoutingStrategyForAuthorizationHeader,
  undoDocumentEditorForAuthorizationHeader,
} from "@clean-pdf/workflow-service";

function sendError(reply: FastifyReply, error: unknown) {
  const typedError = error as AppError;
  return reply.code(typedError.statusCode ?? 500).send({ message: typedError.message });
}

export const documentRoutes: FastifyPluginAsync = async (app) => {
  function getOrigin(request: { headers: { origin?: string | string[] }; protocol: string; host: string }) {
    const originHeader = request.headers.origin;
    return (Array.isArray(originHeader) ? originHeader[0] : originHeader) ?? `${request.protocol}://${request.host}`;
  }

  app.get("/documents", async (request, reply) => {
    try {
      return await listDocumentsForAuthorizationHeader(request.headers.authorization);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents", async (request, reply) => {
    try {
      return await createDocumentForAuthorizationHeader(request.headers.authorization, request.body);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/documents/:documentId", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await getDocumentForAuthorizationHeader(request.headers.authorization, documentId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/lock", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await lockDocumentForAuthorizationHeader(request.headers.authorization, documentId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/reopen", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await reopenDocumentForAuthorizationHeader(request.headers.authorization, documentId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/send", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await sendDocumentForAuthorizationHeader(
        request.headers.authorization,
        documentId,
        getOrigin(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/routing", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await updateDocumentRoutingStrategyForAuthorizationHeader(
        request.headers.authorization,
        documentId,
        request.body,
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/share", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await createDocumentShareLinkForAuthorizationHeader(
        request.headers.authorization,
        documentId,
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/duplicate", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await duplicateDocumentForAuthorizationHeader(request.headers.authorization, documentId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/clear", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await clearDocumentFieldsForAuthorizationHeader(request.headers.authorization, documentId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/undo", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await undoDocumentEditorForAuthorizationHeader(request.headers.authorization, documentId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/redo", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await redoDocumentEditorForAuthorizationHeader(request.headers.authorization, documentId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/delete", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await deleteDocumentForAuthorizationHeader(request.headers.authorization, documentId);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/signers", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await addSignerForAuthorizationHeader(
        request.headers.authorization,
        documentId,
        request.body,
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/fields", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await addFieldForAuthorizationHeader(
        request.headers.authorization,
        documentId,
        request.body,
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/access", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await inviteCollaboratorForAuthorizationHeader(
        request.headers.authorization,
        documentId,
        request.body,
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/fields/:fieldId/complete", async (request, reply) => {
    try {
      const { documentId, fieldId } = request.params as { documentId: string; fieldId: string };
      return await completeFieldForAuthorizationHeader(
        request.headers.authorization,
        documentId,
        fieldId,
        request.body,
        getOrigin(request),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get("/documents/:documentId/download-url", async (request, reply) => {
    try {
      const { documentId } = request.params as { documentId: string };
      return await getDocumentDownloadUrlForAuthorizationHeader(
        request.headers.authorization,
        documentId,
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post("/documents/:documentId/processing/:jobType", async (request, reply) => {
    try {
      const { documentId, jobType } = request.params as {
        documentId: string;
        jobType: "ocr" | "field_detection";
      };
      return await requestProcessingJobForAuthorizationHeader(
        request.headers.authorization,
        documentId,
        jobType,
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });
};
