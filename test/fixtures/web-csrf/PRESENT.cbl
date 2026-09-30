       IDENTIFICATION DIVISION.
       PROGRAM-ID. PRESENT.
      * A token that is only required to be there verifies nothing.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FORM             PIC X(80).
       01 WS-REC              PIC X(80).
       01 WS-CSRF-TOKEN       PIC X(32).
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-FORM) LENGTH(LENGTH OF WS-FORM)
           END-EXEC
           IF WS-CSRF-TOKEN NOT = SPACES
               EXEC CICS WRITE FILE('PAYFILE') FROM(WS-REC)
                    RIDFLD(WS-REC) LENGTH(80) END-EXEC
           END-IF
           EXEC CICS RETURN END-EXEC.
