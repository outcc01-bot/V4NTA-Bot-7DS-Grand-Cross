import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed } from "../../utils/embeds.js";
import {
    createSelectMenu,
} from "../../utils/components.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORY_SELECT_ID = "help-category-select";
const ALL_COMMANDS_ID = "help-all-commands";
const BUG_REPORT_BUTTON_ID = "help-bug-report";
const HELP_MENU_TIMEOUT_MS = 5 * 60 * 1000;

const CATEGORY_ICONS = {
    Core: "ℹ️",
    Moderation: "🛡️",
    Economy: "💰",
    Fun: "🎮",
    Leveling: "📊",
    Utility: "🔧",
    Ticket: "🎫",
    Welcome: "👋",
    Giveaway: "🎉",
    Counter: "🔢",
    Tools: "🛠️",
    Search: "🔍",
    "Reaction Roles": "🎭",
    Community: "👥",
    Birthday: "🎂",
    "Join To Create": "🔌",
    Verification: "✅",
};

function formatCategoryName(rawCategory) {
    return rawCategory
        .replace(/_/g, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export async function createInitialHelpMenu(client) {
    const commandsPath = path.join(__dirname, "../../commands");
    const categoryDirs = (
        await fs.readdir(commandsPath, { withFileTypes: true })
    )
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort();

    const options = [
        {
            label: "📋 Toutes les commandes",
            description: "Parcourir toutes les commandes disponibles dans une seule liste",
            value: ALL_COMMANDS_ID,
        },
        ...categoryDirs.map((category) => {
            const categoryName = formatCategoryName(category);
            const icon = CATEGORY_ICONS[categoryName] || "🔍";
            return {
                label: `${icon} ${categoryName}`,
                description: `Voir les commandes dans la catégorie ${categoryName}`,
                value: category,
            };
        }),
    ];

    const botName = client?.user?.username || "Bot";
    const embed = createEmbed({
        title: `📖 ${botName} Aide`,
        description: 'Configure ton serveur, choisis ce que tu veux activer, puis parcours les commandes ci-dessous.',
        color: 'primary',
        thumbnail: client.user?.displayAvatarURL?.({ size: 1024 }),
        fields: [
            {
                name: '🚀 Premiers pas',
                value: [
                    '**1. Lancer la configuration** — Exécutez `/configwizard` pour configurer le préfixe, le rôle modérateur et les logs.',
                    '**2. Activer les systèmes** — Utilisez `/commands dashboard` pour activer ou désactiver les catégories.',
                    '**3. Parcourir les commandes** — Utilisez le menu ci-dessous pour voir les catégories et commandes.',
                ].join('\n'),
                inline: false,
            },
            {
                name: 'ℹ️ Comment ça fonctionne',
                value: [
                    '• Les commandes du tableau de bord gèrent chaque fonctionnalité de manière visuelle',
                    '• Les paramètres sont enregistrés par serveur',
                    '• Les commandes slash et préfixes fonctionnent une fois activés',
                ].join('\n'),
                inline: false,
            },
            {
                name: '\u200B',
                value: `-# ${botName} est [open source](https://www.youtube.com/watch?v=Aq5WXmQQooo)`,
                inline: false,
            },
        ],
    });

    embed.setFooter({ 
        text: "Fait avec ❤️" 
    });
    embed.setTimestamp();

    const bugReportButton = new ButtonBuilder()
        .setCustomId(BUG_REPORT_BUTTON_ID)
        .setLabel("Signaler un bug")
        .setStyle(ButtonStyle.Danger);

    const supportButton = new ButtonBuilder()
        .setLabel("Serveur de support")
        .setURL("https://discord.gg/fsppzPWscp")
        .setStyle(ButtonStyle.Link);

    const selectRow = createSelectMenu(
        CATEGORY_SELECT_ID,
        "Sélectionnez pour voir les commandes",
        options,
    );

    const buttonRow = new ActionRowBuilder().addComponents([
        bugReportButton,
        supportButton,
    ]);

    return {
        embeds: [embed],
        components: [buttonRow, selectRow],
    };
}

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Affiche le menu d'aide avec toutes les commandes disponibles"),

    async execute(interaction, guildConfig, client) {
        
        const { MessageFlags } = await import('discord.js');
        await InteractionHelper.safeDefer(interaction);
        
        const { embeds, components } = await createInitialHelpMenu(client);

        await InteractionHelper.safeEditReply(interaction, {
            embeds,
            components,
        });

        setTimeout(async () => {
            try {
                if (!InteractionHelper.isInteractionValid(interaction)) {
                    return;
                }

                const closedEmbed = createEmbed({
                    title: "Menu d'aide fermé",
                    description: "Le menu d'aide a été fermé, utilisez /help à nouveau.",
                    color: "secondary",
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [closedEmbed],
                    components: [],
                });
            } catch (error) {
                
            }
        }, HELP_MENU_TIMEOUT_MS);
    },
};
