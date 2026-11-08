use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::scanners::DetectedGame;

/// Una colección de saga con sus juegos
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SagaCollection {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub sort_order: i32,
    pub games: Vec<SagaGame>,
    pub total_games: usize,
}

/// Un juego dentro de una saga
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SagaGame {
    pub id: Option<i64>,
    pub name: String,
    pub release_year: Option<i32>,
    pub console: Option<String>,
    pub cover_path: Option<String>,
    pub platform: String,
}

/// Resultado del algoritmo de agrupación
#[derive(Debug, Serialize, Deserialize)]
pub struct GroupingResult {
    pub sagas: Vec<SagaCollection>,
    pub ungrouped: Vec<SagaGame>,
    pub total_sagas: usize,
}

static SAGA_RULES: &[(&str, &str)] = &[
    ("zelda", "The Legend of Zelda"),
    ("assassin's creed", "Assassin's Creed"),
    ("assassins creed", "Assassin's Creed"),
    ("final fantasy", "Final Fantasy"),
    ("star wars", "Star Wars"),
    ("resident evil", "Resident Evil"),
    ("super mario", "Super Mario"),
    ("mario kart", "Mario Kart"),
    ("sonic", "Sonic the Hedgehog"),
    ("street fighter", "Street Fighter"),
    ("mortal kombat", "Mortal Kombat"),
    ("tekken", "Tekken"),
    ("metroid", "Metroid"),
    ("pokemon", "Pokémon"),
    ("halo", "Halo"),
    ("gears of war", "Gears of War"),
    ("god of war", "God of War"),
    ("uncharted", "Uncharted"),
    ("mass effect", "Mass Effect"),
    ("witcher", "The Witcher"),
    ("elder scrolls", "The Elder Scrolls"),
    ("skyrim", "The Elder Scrolls"),
    ("fallout", "Fallout"),
    ("doom", "Doom"),
    ("quake", "Quake"),
    ("diablo", "Diablo"),
    ("warcraft", "Warcraft"),
    ("starcraft", "Starcraft"),
    ("call of duty", "Call of Duty"),
    ("battlefield", "Battlefield"),
    ("dragon age", "Dragon Age"),
    ("xcom", "XCOM"),
    ("football manager", "Football Manager"),
    ("age of pirates", "Age of Pirates"),
];

/// Detecta la saga de un título usando reglas estáticas.
pub fn detect_saga(title: &str) -> Option<&'static str> {
    let lower = title.to_lowercase();
    for (keyword, saga_name) in SAGA_RULES {
        if lower.contains(keyword) {
            return Some(saga_name);
        }
    }
    None
}

pub fn group_by_saga(games: &[DetectedGame]) -> GroupingResult {
    let mut saga_map: HashMap<String, Vec<SagaGame>> = HashMap::new();
    let mut ungrouped = Vec::new();

    for game in games {
        let saga_name = detect_saga(&game.name);

        let saga_game = SagaGame {
            id: None,
            name: game.name.clone(),
            release_year: game.release_year,
            console: game.console.clone(),
            cover_path: None,
            platform: game.platform.clone(),
        };

        if let Some(saga) = saga_name {
            saga_map
                .entry(saga.to_string())
                .or_default()
                .push(saga_game);
        } else {
            ungrouped.push(saga_game);
        }
    }

    let mut sagas: Vec<SagaCollection> = saga_map
        .into_iter()
        .map(|(name, games)| {
            let mut games = games;
            games.sort_by(|a, b| a.release_year.cmp(&b.release_year));
            SagaCollection {
                id: None,
                name,
                description: None,
                sort_order: 0,
                games: games.clone(),
                total_games: games.len(),
            }
        })
        .collect();

    sagas.sort_by(|a, b| a.name.cmp(&b.name));

    GroupingResult {
        total_sagas: sagas.len(),
        sagas,
        ungrouped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detected(name: &str) -> DetectedGame {
        DetectedGame {
            name: name.to_string(),
            platform: "emulator".to_string(),
            executable_path: None,
            rom_iso_path: None,
            saga: None,
            console: Some("NES".to_string()),
            release_year: Some(1986),
        }
    }

    #[test]
    fn test_zelda_grouping() {
        let games = vec![
            detected("The Legend of Zelda"),
            detected("The Legend of Zelda: The Wind Waker"),
        ];

        let result = group_by_saga(&games);
        assert_eq!(result.total_sagas, 1);
        assert_eq!(result.sagas[0].name, "The Legend of Zelda");
        assert_eq!(result.sagas[0].games.len(), 2);
    }

    #[test]
    fn test_detect_saga() {
        assert_eq!(detect_saga("Dragon Age Origins"), Some("Dragon Age"));
        assert_eq!(detect_saga("XCOM Enemy Within"), Some("XCOM"));
        assert_eq!(detect_saga("Random Indie Game"), None);
    }
}
