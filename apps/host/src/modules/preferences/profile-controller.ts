import type { FastifyReply, FastifyRequest } from "fastify";

import type { PreferenceProfilePatchInput } from "./profile-service.js";
import { PreferenceProfileService } from "./profile-service.js";
import { requireUserId } from "./common.js";

export class ProfileController {
  constructor(private readonly profileService: PreferenceProfileService) {}

  readonly read = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send(this.profileService.getProfile(requireUserId(request)));
  };

  readonly update = async (
    request: FastifyRequest<{ Body: PreferenceProfilePatchInput }>,
    reply: FastifyReply
  ): Promise<void> => {
    reply.send(
      this.profileService.updateProfile(requireUserId(request), request.body ?? {})
    );
  };
}
