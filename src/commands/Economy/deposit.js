import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { successEmbed, buildUserErrorEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData, getMaxBankCapacity } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('deposit')
        .setDescription('Déposer de l\'argent de votre portefeuille vers votre banque')
        .addStringOption(option =>
            option
                .setName('amount')
                .setDescription('Montant à déposer (nombre ou "tout")')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
        
        const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const amountInput = interaction.options.getString("amount");

            const userData = await getEconomyData(client, guildId, userId);
            
            if (!userData) {
                throw createError(
                    "Failed to load economy data",
                    ErrorTypes.DATABASE,
                    "Impossible de charger vos données d'économie. Veuillez réessayer plus tard.",
                    { userId, guildId }
                );
            }
            
            const maxBank = getMaxBankCapacity(userData);
            let depositAmount;

            if (amountInput.toLowerCase() === "all") {
                depositAmount = userData.wallet;
            } else {
                depositAmount = parseInt(amountInput);

                if (isNaN(depositAmount) || depositAmount <= 0) {
                    throw createError(
                        "Invalid deposit amount",
                        ErrorTypes.VALIDATION,
                        `Veuillez entrer un nombre valide ou 'tout'. Vous avez saisi : \`${amountInput}\``,
                        { amountInput, userId }
                    );
                }
            }

            if (depositAmount === 0) {
                throw createError(
                    "Zero deposit amount",
                    ErrorTypes.VALIDATION,
                    "Vous n'avez pas d'argent liquide à déposer.",
                    { userId, walletBalance: userData.wallet }
                );
            }

            if (depositAmount > userData.wallet) {
                depositAmount = userData.wallet;
                await interaction.followUp({
                    embeds: [
                        buildUserErrorEmbed(
                            'validation',
                            `Vous avez essayé de déposer plus que ce que vous possédez. Dépôt de votre argent restant : **$${depositAmount.toLocaleString()}**`
                        )
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const availableSpace = maxBank - userData.bank;

            if (availableSpace <= 0) {
                throw createError(
                    "Bank is full",
                    ErrorTypes.VALIDATION,
                    `Votre banque est actuellement pleine (Capacité maximale : $${maxBank.toLocaleString()}). Achetez une **Amélioration de Banque** pour augmenter votre limite.`,
                    { maxBank, currentBank: userData.bank, userId }
                );
            }

            if (depositAmount > availableSpace) {
                const originalDepositAmount = depositAmount;
                depositAmount = availableSpace;

                if (amountInput.toLowerCase() !== "all") {
                    await interaction.followUp({
                        embeds: [
                            buildUserErrorEmbed(
                                'validation',
                                `Il ne restait de la place que pour **$${depositAmount.toLocaleString()}** dans votre compte bancaire (Max : $${maxBank.toLocaleString()}). Le reste reste dans votre portefeuille.`
                            )
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                }
            }

            if (depositAmount === 0) {
                throw createError(
                    "No space or cash for deposit",
                    ErrorTypes.VALIDATION,
                    "Le montant que vous avez essayé de déposer était de 0 ou dépassait la capacité de votre banque après vérification de votre argent liquide.",
                    { depositAmount, availableSpace, walletBalance: userData.wallet }
                );
            }

            userData.wallet -= depositAmount;
            userData.bank += depositAmount;

            await setEconomyData(client, guildId, userId, userData);

            const embed = successEmbed(
                'Dépôt effectué',
                `Vous avez déposé avec succès **$${depositAmount.toLocaleString()}** dans votre banque.`
            )
                .addFields(
                    {
                        name: "Nouveau solde du portefeuille",
                        value: `$${userData.wallet.toLocaleString()}`,
                        inline: true,
                    },
                    {
                        name: "Nouveau solde bancaire",
                        value: `$${userData.bank.toLocaleString()} / $${maxBank.toLocaleString()}`,
                        inline: true,
                    },
                );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'deposit' })
};
