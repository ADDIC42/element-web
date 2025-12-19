/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { createClient } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { type IMatrixClientCreds } from "../MatrixClientPeg";

export interface CorporateTokenLoginResult {
    success: boolean;
    credentials?: IMatrixClientCreds;
    error?: string;
}

/**
 * Получает корпоративный токен от backend и валидирует его.
 * @returns Promise с результатом входа или null, если токен недоступен
 */
export async function getCorporateToken(): Promise<CorporateTokenLoginResult | null> {
    try {
        // Шаг 1: Получаем токен от корпоративного backend
        const response = await fetch("https://isushi.elitibi.ru/matrix/get_token.php", {
            credentials: "include",
        });

        if (!response.ok) {
            logger.log(`Corporate token not available: HTTP ${response.status}`);
            return null;
        }

        const data = (await response.json()) as {
            ok?: boolean;
            access_token?: string;
            home_server?: string;
            matrix_user_id?: string;
        };

        if (!data.ok || !data.access_token) {
            logger.log("Invalid corporate token response");
            return null;
        }

        // Шаг 2: Определяем homeserver URL
        const defaultHomeServer = "https://matrix.rpadconnect.app";
        const homeServer =
            data.home_server && (data.home_server.startsWith("http://") || data.home_server.startsWith("https://"))
                ? data.home_server
                : data.home_server
                  ? `https://${data.home_server}`
                  : defaultHomeServer;

        // Шаг 3: Валидируем токен через /whoami
        let whoamiResult: { user_id: string; device_id?: string } | null = null;
        try {
            const checkClient = createClient({
                baseUrl: homeServer,
                accessToken: data.access_token,
            });
            whoamiResult = await checkClient.whoami();

            // Проверяем, что токен принадлежит ожидаемому пользователю
            if (data.matrix_user_id && whoamiResult.user_id !== data.matrix_user_id) {
                logger.warn(
                    `Token user mismatch: expected ${data.matrix_user_id}, got ${whoamiResult.user_id}`,
                );
                return {
                    success: false,
                    error: `Токен принадлежит другому пользователю: ожидался ${data.matrix_user_id}, получен ${whoamiResult.user_id}`,
                };
            }
        } catch (checkError) {
            logger.log("Corporate token validation failed", checkError);
            return {
                success: false,
                error: checkError instanceof Error ? checkError.message : "Ошибка валидации токена",
            };
        }

        // Шаг 4: Возвращаем успешный результат с credentials
        if (whoamiResult) {
            return {
                success: true,
                credentials: {
                    homeserverUrl: homeServer,
                    accessToken: data.access_token,
                    userId: whoamiResult.user_id,
                    deviceId: whoamiResult.device_id,
                },
            };
        }

        return {
            success: false,
            error: "Не удалось получить информацию о пользователе",
        };
    } catch (e) {
        logger.log("Corporate token login failed", e);
        return {
            success: false,
            error: e instanceof Error ? e.message : "Неизвестная ошибка при получении токена",
        };
    }
}

