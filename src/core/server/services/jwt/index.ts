import { Redis } from "ioredis";
import Joi from "joi";
import jwt, { SignOptions, VerifyOptions } from "jsonwebtoken";
import { Bearer, BearerOptions } from "permit";
import uuid from "uuid/v4";

import { Omit } from "coral-common/types";
import { Config } from "coral-server/config";
import { AuthenticationError, TokenInvalidError } from "coral-server/errors";
import { Tenant } from "coral-server/models/tenant";
import { User } from "coral-server/models/user";
import { Request } from "coral-server/types/express";

/**
 *  The following Claim Names are registered in the IANA "JSON Web Token
 * Claims" registry established by Section 10.1.  None of the claims
 * defined below are intended to be mandatory to use or implement in all
 * cases, but rather they provide a starting point for a set of useful,
 * interoperable claims.  Applications using JWTs should define which
 * specific claims they use and when they are required or optional.  All
 * the names are short because a core goal of JWTs is for the
 * representation to be compact.
 *
 * https://tools.ietf.org/html/rfc7519#section-4.1
 */
export interface StandardClaims {
  /**
   * The "jti" (JWT ID) claim provides a unique identifier for the JWT. The
   * identifier value MUST be assigned in a manner that ensures that there is a
   * negligible probability that the same value will be accidentally assigned to
   * a different data object; if the application uses multiple issuers,
   * collisions MUST be prevented among values produced by different issuers as
   * well.  The "jti" claim can be used to prevent the JWT from being replayed.
   * The "jti" value is a case- sensitive string.  Use of this claim is
   * OPTIONAL.
   *
   * https://tools.ietf.org/html/rfc7519#section-4.1.7
   */
  jti?: string;

  /**
   * The "aud" (audience) claim identifies the recipients that the JWT is
   * intended for.  Each principal intended to process the JWT MUST
   * identify itself with a value in the audience claim.  If the principal
   * processing the claim does not identify itself with a value in the
   * "aud" claim when this claim is present, then the JWT MUST be
   * rejected.  In the general case, the "aud" value is an array of case-
   * sensitive strings, each containing a StringOrURI value.  In the
   * special case when the JWT has one audience, the "aud" value MAY be a
   * single case-sensitive string containing a StringOrURI value.  The
   * interpretation of audience values is generally application specific.
   * Use of this claim is OPTIONAL.
   *
   * https://tools.ietf.org/html/rfc7519#section-4.1.3
   */
  aud?: string;

  /**
   * The "sub" (subject) claim identifies the principal that is the
   * subject of the JWT. The claims in a JWT are normally statements
   * about the subject. The subject value MUST either be scoped to be
   * locally unique in the context of the issuer or be globally unique.
   * The processing of this claim is generally application specific. The
   * "sub" value is a case-sensitive string containing a StringOrURI
   * value. Use of this claim is OPTIONAL.
   *
   * https://tools.ietf.org/html/rfc7519#section-4.1.2
   */
  sub?: string;

  /**
   * The "iss" (issuer) claim identifies the principal that issued the
   * JWT. The processing of this claim is generally application specific.
   * The "iss" value is a case-sensitive string containing a StringOrURI
   * value. Use of this claim is OPTIONAL.
   *
   * https://tools.ietf.org/html/rfc7519#section-4.1.2
   */
  iss?: string;

  /**
   * The "exp" (expiration time) claim identifies the expiration time on
   * or after which the JWT MUST NOT be accepted for processing.  The
   * processing of the "exp" claim requires that the current date/time
   * MUST be before the expiration date/time listed in the "exp" claim.
   * Implementers MAY provide for some small leeway, usually no more than
   * a few minutes, to account for clock skew.  Its value MUST be a number
   * containing a NumericDate value.  Use of this claim is OPTIONAL.
   *
   * https://tools.ietf.org/html/rfc7519#section-4.1.4
   */
  exp?: number;

  /**
   *  The "nbf" (not before) claim identifies the time before which the JWT
   * MUST NOT be accepted for processing.  The processing of the "nbf"
   * claim requires that the current date/time MUST be after or equal to
   * the not-before date/time listed in the "nbf" claim.  Implementers MAY
   * provide for some small leeway, usually no more than a few minutes, to
   * account for clock skew.  Its value MUST be a number containing a
   * NumericDate value.  Use of this claim is OPTIONAL.
   *
   * https://tools.ietf.org/html/rfc7519#section-4.1.5
   */
  nbf?: number;

  /**
   * The "iat" (issued at) claim identifies the time at which the JWT was
   * issued.  This claim can be used to determine the age of the JWT.  Its
   * value MUST be a number containing a NumericDate value.  Use of this
   * claim is OPTIONAL.
   *
   * https://tools.ietf.org/html/rfc7519#section-4.1.6
   */
  iat?: number;
}

export const StandardClaimsSchema = Joi.object().keys({
  jti: Joi.string(),
  aud: Joi.string(),
  sub: Joi.string(),
  iss: Joi.string(),
  exp: Joi.number(),
  nbf: Joi.number(),
  iat: Joi.number(),
});

export enum AsymmetricSigningAlgorithm {
  RS256 = "RS256",
  RS384 = "RS384",
  RS512 = "RS512",
  ES256 = "ES256",
  ES384 = "ES384",
  ES512 = "ES512",
}

export enum SymmetricSigningAlgorithm {
  HS256 = "HS256",
  HS384 = "HS384",
  HS512 = "HS512",
}

export type JWTSigningAlgorithm =
  | AsymmetricSigningAlgorithm
  | SymmetricSigningAlgorithm;

export interface JWTSigningConfig {
  secret: Buffer | string;
  algorithm: JWTSigningAlgorithm;
}

export function createAsymmetricSigningConfig(
  algorithm: AsymmetricSigningAlgorithm,
  secret: string
): JWTSigningConfig {
  return {
    // Secrets have their newlines encoded with newline literals.
    secret: Buffer.from(secret.replace(/\\n/g, "\n"), "utf8"),
    algorithm,
  };
}

export function createSymmetricSigningConfig(
  algorithm: SymmetricSigningAlgorithm,
  secret: string
): JWTSigningConfig {
  return {
    secret,
    algorithm,
  };
}

function isSymmetricSigningAlgorithm(
  algorithm: string | SymmetricSigningAlgorithm
): algorithm is SymmetricSigningAlgorithm {
  return algorithm in SymmetricSigningAlgorithm;
}

function isAsymmetricSigningAlgorithm(
  algorithm: string | AsymmetricSigningAlgorithm
): algorithm is AsymmetricSigningAlgorithm {
  return algorithm in AsymmetricSigningAlgorithm;
}

/**
 * Parses the config and provides the signing config.
 *
 * @param config the server configuration
 */
export function createJWTSigningConfig(config: Config): JWTSigningConfig {
  const secret = config.get("signing_secret");
  const algorithm = config.get("signing_algorithm");
  if (isSymmetricSigningAlgorithm(algorithm)) {
    return createSymmetricSigningConfig(algorithm, secret);
  } else if (isAsymmetricSigningAlgorithm(algorithm)) {
    return createAsymmetricSigningConfig(algorithm, secret);
  }

  throw new AuthenticationError(`invalid algorithm=${algorithm} specified`);
}

export type SigningTokenOptions = Pick<
  SignOptions,
  "jwtid" | "audience" | "issuer" | "expiresIn" | "notBefore"
>;

export const signTokenString = async (
  { algorithm, secret }: JWTSigningConfig,
  user: Pick<User, "id">,
  tenant: Pick<Tenant, "id">,
  options: SigningTokenOptions = {}
) =>
  jwt.sign({}, secret, {
    jwtid: uuid(),
    // TODO: (wyattjoh) evaluate allowing configuration?
    expiresIn: "1 day",
    ...options,
    issuer: tenant.id,
    subject: user.id,
    algorithm,
  });

export const signPATString = async (
  { algorithm, secret }: JWTSigningConfig,
  user: User,
  options: SigningTokenOptions
) =>
  jwt.sign({ pat: true }, secret, {
    ...options,
    subject: user.id,
    algorithm,
  });

export async function signString<T extends {}>(
  { algorithm, secret }: JWTSigningConfig,
  payload: T,
  options: Omit<SignOptions, "algorithm"> = {}
) {
  return jwt.sign(payload, secret, { ...options, algorithm });
}

/**
 *
 * @param req the request to extract the JWT from
 * @param excludeQuery when true, does not pull from the query params
 */
export function extractJWTFromRequest(
  req: Request,
  excludeQuery: boolean = false
) {
  const options: BearerOptions = {
    basic: "password",
  };

  if (!excludeQuery) {
    options.query = "accessToken";
  }

  const permit = new Bearer(options);

  return permit.check(req) || null;
}

function generateJTIRevokedKey(jti: string) {
  // jtir: JTI Revoked namespace.
  return `jtir:${jti}`;
}

export async function revokeJWT(redis: Redis, jti: string, validFor: number) {
  await redis.setex(
    generateJTIRevokedKey(jti),
    Math.ceil(validFor),
    Date.now()
  );
}

export async function checkJWTRevoked(redis: Redis, jti: string) {
  const expiredAtString = await redis.get(generateJTIRevokedKey(jti));
  if (expiredAtString) {
    throw new AuthenticationError("JWT was revoked");
  }
}

export function verifyJWT(
  tokenString: string,
  { algorithm, secret }: JWTSigningConfig,
  now: Date,
  options: Omit<VerifyOptions, "algorithms" | "clockTimestamp"> = {}
) {
  try {
    return jwt.verify(tokenString, secret, {
      ...options,
      algorithms: [algorithm],
      clockTimestamp: Math.floor(now.getTime() / 1000),
    }) as object;
  } catch (err) {
    throw new TokenInvalidError(tokenString, "token validation error", err);
  }
}

export function decodeJWT(tokenString: string) {
  try {
    return jwt.decode(tokenString, {}) as StandardClaims;
  } catch (err) {
    throw new TokenInvalidError(tokenString, "token validation error", err);
  }
}