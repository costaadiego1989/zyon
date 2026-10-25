import {
  Body,
  Controller,
  Get,
  Post,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  Headers,
} from "@nestjs/common";
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
} from "@nestjs/swagger";
import { IsString, IsOptional } from "class-validator";
import { StartProtocolSessionUseCase, type StartProtocolSessionInput } from "../../application/start-protocol-session.use-case.js";
import { TransitionProtocolStateUseCase } from "../../application/transition-protocol-state.use-case.js";
import { GetProtocolStateUseCase } from "../../application/get-protocol-state.use-case.js";

class StartProtocolSessionDto {
  @IsString()
  merchant_id!: string;

  @IsString()
  agent_id!: string;

  @IsOptional()
  @IsString()
  callback_url?: string;
}

class TransitionProtocolStateDto {
  @IsString()
  action!: string;

  @IsOptional()
  payload?: Record<string, unknown>;
}

@ApiTags("Protocol (Agentic Checkout)")
@ApiBearerAuth("agent_session_token")
@Controller("protocol")
export class ProtocolAgentController {
  constructor(
    private readonly startSession: StartProtocolSessionUseCase,
    private readonly transitionState: TransitionProtocolStateUseCase,
    private readonly getState: GetProtocolStateUseCase
  ) {}

  @Post("start")
  @ApiOperation({
    summary: "Start an agent checkout protocol session",
    description: "Creates a new protocol session and issues a JWT token. Initial state is 'idle'.",
  })
  @ApiBody({ type: StartProtocolSessionDto })
  @ApiResponse({
    status: 201,
    description: "Session created",
    schema: {
      type: "object",
      properties: {
        session_token: { type: "string" },
        session_id: { type: "string" },
        current_state: { type: "string", example: "idle" },
        expires_at: { type: "string", format: "date-time" },
        allowed_next_actions: { type: "array", items: { type: "string" } },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid request" })
  async start(@Body() body: StartProtocolSessionDto) {
    if (!body.merchant_id || !body.agent_id) {
      throw new BadRequestException("merchant_id and agent_id are required");
    }

    const input: StartProtocolSessionInput = {
      merchant_id: body.merchant_id,
      agent_id: body.agent_id,
      callback_url: body.callback_url,
    };

    return this.startSession.execute(input);
  }

  @Post("discover")
  @ApiOperation({
    summary: "Transition from idle → discovered",
    description: "Agent requests product discovery. Requires token issued in 'idle' state.",
  })
  @ApiHeader({ name: "Authorization", description: "Bearer <session_token>" })
  @ApiBody({ type: TransitionProtocolStateDto })
  @ApiResponse({
    status: 200,
    description: "State transitioned",
    schema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        session_token: { type: "string" },
        current_state: { type: "string", example: "discovered" },
        previous_state: { type: "string", example: "idle" },
        expires_at: { type: "string", format: "date-time" },
        allowed_next_actions: { type: "array", items: { type: "string" } },
      },
    },
  })
  @ApiResponse({ status: 409, description: "Invalid state transition" })
  @ApiResponse({ status: 401, description: "Invalid or expired token" })
  async discover(
    @Headers("authorization") authHeader: string,
    @Body() body: TransitionProtocolStateDto
  ) {
    const token = extractToken(authHeader);
    return this.transitionState.execute({
      session_token: token,
      action: "discover",
      payload: body.payload,
    });
  }

  @Post("negotiate")
  @ApiOperation({
    summary: "Transition from discovered → negotiated",
    description: "Agent initiates price negotiation.",
  })
  @ApiHeader({ name: "Authorization", description: "Bearer <session_token>" })
  @ApiBody({ type: TransitionProtocolStateDto })
  @ApiResponse({ status: 200, description: "State transitioned" })
  @ApiResponse({ status: 409, description: "Invalid state transition" })
  @ApiResponse({ status: 401, description: "Invalid or expired token" })
  async negotiate(
    @Headers("authorization") authHeader: string,
    @Body() body: TransitionProtocolStateDto
  ) {
    const token = extractToken(authHeader);
    return this.transitionState.execute({
      session_token: token,
      action: "negotiate",
      payload: body.payload,
    });
  }

  @Post("quote")
  @ApiOperation({
    summary: "Transition from negotiated → quoted",
    description: "Agent requests final quote.",
  })
  @ApiHeader({ name: "Authorization", description: "Bearer <session_token>" })
  @ApiBody({ type: TransitionProtocolStateDto })
  @ApiResponse({ status: 200, description: "State transitioned" })
  @ApiResponse({ status: 409, description: "Invalid state transition" })
  @ApiResponse({ status: 401, description: "Invalid or expired token" })
  async quote(
    @Headers("authorization") authHeader: string,
    @Body() body: TransitionProtocolStateDto
  ) {
    const token = extractToken(authHeader);
    return this.transitionState.execute({
      session_token: token,
      action: "quote",
      payload: body.payload,
    });
  }

  @Post("checkout")
  @ApiOperation({
    summary: "Transition from quoted → confirmed",
    description: "Agent confirms order checkout.",
  })
  @ApiHeader({ name: "Authorization", description: "Bearer <session_token>" })
  @ApiBody({ type: TransitionProtocolStateDto })
  @ApiResponse({ status: 200, description: "State transitioned" })
  @ApiResponse({ status: 409, description: "Invalid state transition" })
  @ApiResponse({ status: 401, description: "Invalid or expired token" })
  async checkout(
    @Headers("authorization") authHeader: string,
    @Body() body: TransitionProtocolStateDto
  ) {
    const token = extractToken(authHeader);
    return this.transitionState.execute({
      session_token: token,
      action: "checkout",
      payload: body.payload,
    });
  }

  @Post("pay")
  @ApiOperation({
    summary: "Transition from confirmed → payment_pending",
    description: "Agent initiates payment.",
  })
  @ApiHeader({ name: "Authorization", description: "Bearer <session_token>" })
  @ApiBody({ type: TransitionProtocolStateDto })
  @ApiResponse({ status: 200, description: "State transitioned" })
  @ApiResponse({ status: 409, description: "Invalid state transition" })
  @ApiResponse({ status: 401, description: "Invalid or expired token" })
  async pay(
    @Headers("authorization") authHeader: string,
    @Body() body: TransitionProtocolStateDto
  ) {
    const token = extractToken(authHeader);
    return this.transitionState.execute({
      session_token: token,
      action: "pay",
      payload: body.payload,
    });
  }

  @Get("track")
  @ApiOperation({
    summary: "Transition from paid → tracking (terminal)",
    description: "Agent requests fulfillment tracking. This is a read-only terminal state.",
  })
  @ApiHeader({ name: "Authorization", description: "Bearer <session_token>" })
  @ApiResponse({ status: 200, description: "Transitioned to tracking" })
  @ApiResponse({ status: 409, description: "Invalid state transition" })
  @ApiResponse({ status: 401, description: "Invalid or expired token" })
  async track(@Headers("authorization") authHeader: string) {
    const token = extractToken(authHeader);
    return this.transitionState.execute({
      session_token: token,
      action: "track",
    });
  }

  @Get("state")
  @ApiOperation({
    summary: "Inspect current protocol session state",
    description: "Returns full state history and allowed next actions. Read-only.",
  })
  @ApiHeader({ name: "Authorization", description: "Bearer <session_token>" })
  @ApiResponse({
    status: 200,
    description: "State retrieved",
    schema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        current_state: { type: "string" },
        state_history: {
          type: "array",
          items: {
            type: "object",
            properties: {
              state: { type: "string" },
              entered_at: { type: "string", format: "date-time" },
            },
          },
        },
        allowed_next_actions: { type: "array", items: { type: "string" } },
        expires_at: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Invalid or expired token" })
  async state(@Headers("authorization") authHeader: string) {
    const token = extractToken(authHeader);
    return this.getState.execute(token);
  }
}

function extractToken(authHeader: string | undefined): string {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedException("Missing or invalid Authorization header");
  }
  return authHeader.substring(7);
}
