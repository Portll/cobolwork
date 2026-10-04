ATTACHNAMED CSECT
            STM   14,12,12(13)
            LR    12,15
            USING ATTACHNAMED,12
            ATTACH EP=HELLO
            LM    14,12,12(13)
            SR    15,15
            BR    14
            END
