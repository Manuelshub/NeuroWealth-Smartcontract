#![cfg(test)]

use crate::tests::utils::setup_vault;

#[test]
fn test_withdrawal_queue_ordering_cancellation_and_processing() {
    let (_env, client, owner, agent, user, _, _) = setup_vault();

    // Configure queue: max_size = 5, ttl = 3600s
    client.set_queue_config(&owner, &5u32, &3600u64).unwrap();
    let (max_size, ttl) = client.get_queue_config();
    assert_eq!(max_size, 5);
    assert_eq!(ttl, 3600);

    // Queue withdrawal request
    let req_id1 = client.queue_withdrawal(&user, &200_0000000);
    assert_eq!(req_id1, 1);

    let req1 = client.get_withdrawal_request(&req_id1).unwrap();
    assert_eq!(req1.user, user);
    assert_eq!(req1.amount, 200_0000000);
    assert!(!req1.fulfilled);
    assert!(!req1.cancelled);

    // Queue second withdrawal request
    let req_id2 = client.queue_withdrawal(&user, &100_0000000);
    assert_eq!(req_id2, 2);

    // Cancel req2
    client.cancel_withdrawal_request(&user, &req_id2);
    assert!(client.try_get_withdrawal_request(&req_id2).is_err());

    // Agent processes queue in FIFO order
    let processed = client.process_withdrawal_queue(&agent, &10u32);
    assert_eq!(processed, 1); // 1 fulfilled, 1 cancelled skipped

    assert!(client.try_get_withdrawal_request(&req_id1).is_err());
}

#[test]
fn test_any_authenticated_keeper_can_process_bounded_queue() {
    let (env, client, owner, _agent, user, _, _) = setup_vault();
    let keeper = soroban_sdk::Address::generate(&env);
    client.set_queue_config(&owner, &100u32, &3600u64).unwrap();

    for _ in 0..55 {
        client.queue_withdrawal(&user, &1);
    }

    assert_eq!(
        client.process_withdrawal_queue(&keeper, &u32::MAX),
        crate::MAX_WITHDRAWAL_PROCESS_BATCH,
    );
    assert_eq!(client.process_withdrawal_queue(&user, &u32::MAX), 5);
}
