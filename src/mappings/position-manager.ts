/* eslint-disable prefer-const */
import {
  Collect,
  DecreaseLiquidity,
  IncreaseLiquidity,
  NonfungiblePositionManager,
  Transfer
} from '../types/NonfungiblePositionManager/NonfungiblePositionManager'
import { Position, PositionSnapshot, Token, YieldFarmer } from '../types/schema'
import { ADDRESS_ZERO, factoryContract, ZERO_BD, ZERO_BI } from '../utils/constants'
import { Address, BigInt, ethereum, log } from '@graphprotocol/graph-ts'
import { convertTokenToDecimal, loadTransaction } from '../utils'

export function getPosition(event: ethereum.Event, tokenId: BigInt): Position {
  let position = Position.load(tokenId.toString())
  if (position === null) {
    let contract = NonfungiblePositionManager.bind(event.address)
    let positionCall = contract.try_positions(tokenId)

    let zeroOwner = YieldFarmer.load(ADDRESS_ZERO)
    if (!zeroOwner) {
      zeroOwner = new YieldFarmer(ADDRESS_ZERO)
      zeroOwner.save()
    }

    // the following call reverts in situations where the position is minted
    // and deleted in the same block - from my investigation this happens
    // in calls from  BancorSwap
    // (e.g. 0xf7867fa19aa65298fadb8d4f72d0daed5e836f3ba01f0b9b9631cdc6c36bed40)
    if (!positionCall.reverted) {
      let positionResult = positionCall.value
      let owner = YieldFarmer.load(positionResult.getOperator().toHex())
      if (!owner) {
        owner = new YieldFarmer(positionResult.getOperator().toHex())
        owner.save()
      }
      let poolAddress = factoryContract.try_getPool(positionResult.value2, positionResult.value3, positionResult.value4)
      if (poolAddress.reverted) {
        position = new Position(tokenId.toString())

        position.owner = owner.id
        position.minter = owner.id
        position.pool = ADDRESS_ZERO
        position.token0 = ADDRESS_ZERO
        position.token1 = ADDRESS_ZERO
        position.tickLower = position.pool.concat('#').concat('0')
        position.tickUpper = position.pool.concat('#').concat('0')
        position.liquidity = ZERO_BI
        position.depositedToken0 = ZERO_BD
        position.depositedToken1 = ZERO_BD
        position.withdrawnToken0 = ZERO_BD
        position.withdrawnToken1 = ZERO_BD
        position.collectedFeesToken0 = ZERO_BD
        position.collectedFeesToken1 = ZERO_BD
        position.transaction = loadTransaction(event).id
        position.feeGrowthInside0LastX128 = BigInt.fromI32(0)
        position.feeGrowthInside1LastX128 = BigInt.fromI32(0)
      } else {
        position = new Position(tokenId.toString())

        // The owner & minter gets correctly updated in the Transfer handler
        position.owner = owner.id
        position.minter = zeroOwner.id
        position.pool = poolAddress.value.toHexString()
        position.token0 = positionResult.value2.toHexString()
        position.token1 = positionResult.value3.toHexString()
        position.tickLower = position.pool.concat('#').concat(positionResult.value5.toString())
        position.tickUpper = position.pool.concat('#').concat(positionResult.value6.toString())
        position.liquidity = ZERO_BI
        position.depositedToken0 = ZERO_BD
        position.depositedToken1 = ZERO_BD
        position.withdrawnToken0 = ZERO_BD
        position.withdrawnToken1 = ZERO_BD
        position.collectedFeesToken0 = ZERO_BD
        position.collectedFeesToken1 = ZERO_BD
        position.transaction = loadTransaction(event).id
        position.feeGrowthInside0LastX128 = positionResult.value8
        position.feeGrowthInside1LastX128 = positionResult.value9
      }
    } else {
      log.warning('Call reverted for tokenId: {}', [tokenId.toString()])

      position = new Position(tokenId.toString())
      // The owner & minter gets correctly updated in the Transfer handler
      position.owner = zeroOwner.id
      position.minter = zeroOwner.id
      position.pool = ADDRESS_ZERO
      position.token0 = ADDRESS_ZERO
      position.token1 = ADDRESS_ZERO
      position.tickLower = position.pool.concat('#').concat('0')
      position.tickUpper = position.pool.concat('#').concat('0')
      position.liquidity = ZERO_BI
      position.depositedToken0 = ZERO_BD
      position.depositedToken1 = ZERO_BD
      position.withdrawnToken0 = ZERO_BD
      position.withdrawnToken1 = ZERO_BD
      position.collectedFeesToken0 = ZERO_BD
      position.collectedFeesToken1 = ZERO_BD
      position.transaction = loadTransaction(event).id
      position.feeGrowthInside0LastX128 = BigInt.fromI32(0)
      position.feeGrowthInside1LastX128 = BigInt.fromI32(0)
    }
    position.save()
  }

  return position
}

function updateFeeVars(position: Position, event: ethereum.Event, tokenId: BigInt): Position {
  let positionManagerContract = NonfungiblePositionManager.bind(event.address)
  let positionResult = positionManagerContract.try_positions(tokenId)
  if (!positionResult.reverted) {
    position.feeGrowthInside0LastX128 = positionResult.value.value8
    position.feeGrowthInside1LastX128 = positionResult.value.value9
  }
  return position
}

function savePositionSnapshot(position: Position, event: ethereum.Event): void {
  let positionSnapshot = new PositionSnapshot(position.id.concat('#').concat(event.block.number.toString()))
  positionSnapshot.owner = position.owner
  positionSnapshot.pool = position.pool
  positionSnapshot.position = position.id
  positionSnapshot.blockNumber = event.block.number
  positionSnapshot.timestamp = event.block.timestamp
  positionSnapshot.liquidity = position.liquidity
  positionSnapshot.depositedToken0 = position.depositedToken0
  positionSnapshot.depositedToken1 = position.depositedToken1
  positionSnapshot.withdrawnToken0 = position.withdrawnToken0
  positionSnapshot.withdrawnToken1 = position.withdrawnToken1
  positionSnapshot.collectedFeesToken0 = position.collectedFeesToken0
  positionSnapshot.collectedFeesToken1 = position.collectedFeesToken1
  positionSnapshot.transaction = loadTransaction(event).id
  positionSnapshot.feeGrowthInside0LastX128 = position.feeGrowthInside0LastX128
  positionSnapshot.feeGrowthInside1LastX128 = position.feeGrowthInside1LastX128
  positionSnapshot.save()
}

export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
  // temp fix
  if (event.block.number.equals(BigInt.fromI32(14317993))) {
    return
  }

  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    return
  }

  // temp fix
  if (Address.fromString(position.pool).equals(Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248'))) {
    return
  }

  let token0 = Token.load(position.token0)
  if (token0 == null) {
    return
  }
  let token1 = Token.load(position.token1)
  if (token1 == null) {
    return
  }

  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

  position.liquidity = position.liquidity.plus(event.params.liquidity)
  position.depositedToken0 = position.depositedToken0.plus(amount0)
  position.depositedToken1 = position.depositedToken1.plus(amount1)

  updateFeeVars(position, event, event.params.tokenId)

  position.save()

  savePositionSnapshot(position, event)
}

export function handleDecreaseLiquidity(event: DecreaseLiquidity): void {
  // temp fix
  if (event.block.number == BigInt.fromI32(14317993)) {
    return
  }

  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    return
  }

  // temp fix
  if (Address.fromString(position.pool).equals(Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248'))) {
    return
  }

  let token0 = Token.load(position.token0)
  if (token0 == null) {
    return
  }
  let token1 = Token.load(position.token1)
  if (token1 == null) {
    return
  }
  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals)

  position.liquidity = position.liquidity.minus(event.params.liquidity)
  position.withdrawnToken0 = position.withdrawnToken0.plus(amount0)
  position.withdrawnToken1 = position.withdrawnToken1.plus(amount1)

  position = updateFeeVars(position, event, event.params.tokenId)
  position.save()
  savePositionSnapshot(position, event)
}

export function handleCollect(event: Collect): void {
  let position = getPosition(event, event.params.tokenId)
  // position was not able to be fetched
  if (position == null) {
    return
  }
  if (Address.fromString(position.pool).equals(Address.fromHexString('0x8fe8d9bb8eeba3ed688069c3d6b556c9ca258248'))) {
    return
  }

  let token0 = Token.load(position.token0)
  if (token0 == null) {
    return
  }
  let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals)
  position.collectedFeesToken0 = position.collectedFeesToken0.plus(amount0)
  position.collectedFeesToken1 = position.collectedFeesToken1.plus(amount0)

  position = updateFeeVars(position, event, event.params.tokenId)
  position.save()
  savePositionSnapshot(position, event)
}

export function handleTransfer(event: Transfer): void {
  let position = getPosition(event, event.params.tokenId)

  // position was not able to be fetched
  if (position == null) {
    return
  }

  let oldOwner = YieldFarmer.load(event.params.from.toHex())
  if (!oldOwner) {
    oldOwner = new YieldFarmer(event.params.from.toHex())
    oldOwner.save()
  }
  let newOwner = YieldFarmer.load(event.params.to.toHex())
  if (!newOwner) {
    newOwner = new YieldFarmer(event.params.to.toHex())
    newOwner.save()
  }

  position.owner = newOwner.id
  if (Address.fromHexString(position.minter).equals(Address.fromHexString(ADDRESS_ZERO))) {
    position.minter = oldOwner.id
  }
  position.save()

  savePositionSnapshot(position, event)
}
