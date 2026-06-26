import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { shopItems } from '../../config/shop/items.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const SHOP_ITEMS = shopItems;

export default {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Acheter un objet dans la boutique')
        .addStringOption(option =>
            option
                .setName('item_id')
                .setDescription("ID de l'objet à acheter")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('quantity')
                .setDescription('Quantité à acheter (par défaut : 1)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(10)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const itemId = interaction.options.getString("item_id").toLowerCase();
            const quantity = interaction.options.getInteger("quantity") || 1;

            const item = SHOP_ITEMS.find(i => i.id === itemId);

            if (!item) {
                throw createError(
                    `Item ${itemId} not found`,
                    ErrorTypes.VALIDATION,
                    `L'ID de l'objet \`${itemId}\` n'existe pas dans la boutique.`,
                    { itemId }
                );
            }

            if (quantity < 1) {
                throw createError(
                    "Quantité invalide",
                    ErrorTypes.VALIDATION,
                    "Vous devez acheter une quantité d'au moins 1.",
                    { quantity }
                );
            }

            const totalCost = item.price * quantity;

            const guildConfig = await getGuildConfig(client, guildId);
            const PREMIUM_ROLE_ID = guildConfig.premiumRoleId;

            const userData = await getEconomyData(client, guildId, userId);

            if (userData.wallet < totalCost) {
                throw createError(
                    "Fonds insuffisants",
                    ErrorTypes.VALIDATION,
                    `Vous avez besoin de **$${totalCost.toLocaleString()}** pour acheter ${quantity}x **${item.name}**, mais vous ne possédez que **$${userData.wallet.toLocaleString()}** en liquide.`,
                    { required: totalCost, current: userData.wallet, itemId, quantity }
                );
            }

            if (item.type === "role" && itemId === "premium_role") {
                if (!PREMIUM_ROLE_ID) {
                    throw createError(
                        "Rôle Premium non configuré",
                        ErrorTypes.CONFIGURATION,
                        "Le **Rôle Premium de la boutique** n'a pas encore été configuré par un administrateur du serveur.",
                        { itemId }
                    );
                }
                if (interaction.member.roles.cache.has(PREMIUM_ROLE_ID)) {
                    throw createError(
                        "Rôle déjà possédé",
                        ErrorTypes.VALIDATION,
                        `Vous possédez déjà le rôle **${item.name}**.`,
                        { itemId, roleId: PREMIUM_ROLE_ID }
                    );
                }
                if (quantity > 1) {
                    throw createError(
                        "Quantité invalide pour un rôle",
                        ErrorTypes.VALIDATION,
                        `Vous ne pouvez acheter le rôle **${item.name}** qu'une seule fois.`,
                        { itemId, quantity }
                    );
                }
            }

            userData.wallet -= totalCost;

            let successDescription = `Vous avez acheté avec succès ${quantity}x **${item.name}** pour **$${totalCost.toLocaleString()}** !`;

            if (item.type === "role" && itemId === "premium_role") {
                const member = interaction.member;

                const role = interaction.guild.roles.cache.get(PREMIUM_ROLE_ID);

                if (!role) {
                    throw createError(
                        "Rôle introuvable",
                        ErrorTypes.CONFIGURATION,
                        "Le rôle Premium configuré n'existe plus sur ce serveur.",
                        { roleId: PREMIUM_ROLE_ID }
                    );
                }

                try {
                    await member.roles.add(
                        role,
                        `Rôle acheté : ${item.name}`,
                    );
                    successDescription += `\n\n**👑 Le rôle ${role.toString()} vous a été attribué !**`;
                } catch (roleError) {
                    userData.wallet += totalCost;
                    await setEconomyData(client, guildId, userId, userData);
                    throw createError(
                        "Échec de l'attribution du rôle",
                        ErrorTypes.DISCORD_API,
                        "L'argent a bien été débité, mais le rôle n'a pas pu être attribué. Votre argent vous a été remboursé.",
                        { roleId: PREMIUM_ROLE_ID, originalError: roleError.message }
                    );
                }
            } else if (item.type === "upgrade") {
                userData.upgrades[itemId] = true;
                successDescription += `\n\n**✨ Votre amélioration est maintenant active !**`;
            } else if (item.type === "consumable") {
                userData.inventory[itemId] =
                    (userData.inventory[itemId] || 0) + quantity;
            }

            await setEconomyData(client, guildId, userId, userData);

            const embed = successEmbed(
                "💰 Achat réussi",
                successDescription,
            ).addFields({
                name: "Nouveau solde",
                value: `$${userData.wallet.toLocaleString()}`,
                inline: true,
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: [MessageFlags.Ephemeral] });
    }, { command: 'buy' })
};
